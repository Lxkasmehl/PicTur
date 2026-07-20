import express, { Request, Response } from 'express';
import db from '../db/database.js';
import { getGroup, getGroupAreas } from '../db/groupsRepo.js';
import { authenticateToken, AuthRequest, requireEmailVerified } from '../middleware/auth.js';
import { requireTeamLead } from '../middleware/teamLead.js';
import type { GroupRole } from '../types/group.js';
import type { UserRole } from '../types/user.js';

const router = express.Router();

// Every lead route requires a verified email and a caller who is a Team Lead.
router.use(authenticateToken, requireEmailVerified, requireTeamLead);

interface MemberRow {
  id: number;
  email: string;
  role: UserRole;
  group_id: number | null;
  group_role: GroupRole;
}

function leadContext(req: Request): { groupId: number; callerId: number } | null {
  const authReq = req as AuthRequest;
  const groupId = authReq.leadGroupId;
  const callerId = authReq.user?.id;
  if (groupId === undefined || callerId === undefined) {
    return null;
  }
  return { groupId, callerId };
}

// The lead's own group: metadata, areas, and members ordered by join date.
router.get('/group', (req: Request, res: Response) => {
  try {
    const ctx = leadContext(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const group = getGroup(ctx.groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const members = db
      .prepare(
        'SELECT id, email, name, role, group_role, created_at FROM users WHERE group_id = ? ORDER BY created_at ASC'
      )
      .all(ctx.groupId) as Array<{
      id: number;
      email: string;
      name: string | null;
      role: UserRole;
      group_role: GroupRole;
      created_at: string;
    }>;

    res.json({
      success: true,
      group: { id: group.id, name: group.name, scope: group.scope, system_key: group.system_key },
      areas: getGroupAreas(group.id),
      members,
    });
  } catch (error) {
    console.error('Lead get group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Claim an unassigned community user into the lead's group as a plain member.
router.post('/members/claim', (req: Request, res: Response) => {
  try {
    const ctx = leadContext(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rawEmail = (req.body as { email?: unknown }).email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const target = db
      .prepare('SELECT id, email, role, group_id, group_role FROM users WHERE email = ?')
      .get(email) as MemberRow | undefined;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.group_id !== null || target.role !== 'community') {
      res.status(400).json({ error: 'Only unassigned community users can be claimed' });
      return;
    }

    db.prepare(
      "UPDATE users SET group_id = ?, group_role = 'member', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(ctx.groupId, target.id);

    res.json({
      success: true,
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        group_id: ctx.groupId,
        group_role: 'member',
      },
    });
  } catch (error) {
    console.error('Lead claim member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Promote / demote a member one rung within the lead's group.
router.patch('/members/:id/rank', (req: Request, res: Response) => {
  try {
    const ctx = leadContext(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const action = (req.body as { action?: unknown }).action;
    if (action !== 'promote' && action !== 'demote') {
      res.status(400).json({ error: "action must be 'promote' or 'demote'" });
      return;
    }

    const target = db
      .prepare('SELECT id, email, role, group_id, group_role FROM users WHERE id = ?')
      .get(targetId) as MemberRow | undefined;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.group_id !== ctx.groupId) {
      res.status(403).json({ error: 'User is not in your group' });
      return;
    }
    if (target.id === ctx.callerId) {
      res.status(400).json({ error: 'You cannot change your own rank' });
      return;
    }
    if (target.role === 'admin') {
      res.status(403).json({ error: 'Cannot change the rank of an admin' });
      return;
    }

    let newRole: UserRole = target.role;
    let newGroupRole: GroupRole = target.group_role === 'lead' ? 'lead' : 'member';
    let bump = false;

    if (action === 'promote') {
      if (target.role === 'community') {
        newRole = 'staff';
        newGroupRole = 'member';
      } else if (target.role === 'staff' && newGroupRole === 'member') {
        newGroupRole = 'lead';
      } else {
        // staff + lead
        res.status(400).json({ error: 'User is already at the top rank' });
        return;
      }
    } else {
      // demote — reducing privileges always bumps revocation.
      if (target.role === 'staff' && newGroupRole === 'lead') {
        newGroupRole = 'member';
        bump = true;
      } else if (target.role === 'staff' && newGroupRole === 'member') {
        newRole = 'community';
        bump = true;
      } else {
        // community
        res.status(400).json({ error: 'User is already at the bottom rank' });
        return;
      }
    }

    db.prepare(
      'UPDATE users SET role = ?, group_role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(newRole, newGroupRole, target.id);
    if (bump) {
      db.prepare('UPDATE users SET tokens_valid_after = CURRENT_TIMESTAMP WHERE id = ?').run(target.id);
    }

    res.json({
      success: true,
      user: { id: target.id, email: target.email, role: newRole, group_role: newGroupRole },
    });
  } catch (error) {
    console.error('Lead rank member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Release a member back to Unassigned (staff are demoted to community, which bumps revocation).
router.delete('/members/:id', (req: Request, res: Response) => {
  try {
    const ctx = leadContext(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const target = db
      .prepare('SELECT id, email, role, group_id, group_role FROM users WHERE id = ?')
      .get(targetId) as MemberRow | undefined;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.group_id !== ctx.groupId) {
      res.status(403).json({ error: 'User is not in your group' });
      return;
    }
    if (target.id === ctx.callerId) {
      res.status(400).json({ error: 'You cannot remove yourself from the group' });
      return;
    }
    if (target.role === 'admin') {
      res.status(403).json({ error: 'Cannot remove an admin' });
      return;
    }

    const wasStaff = target.role === 'staff';
    const newRole: UserRole = wasStaff ? 'community' : target.role;
    db.prepare(
      "UPDATE users SET group_id = NULL, group_role = 'member', role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(newRole, target.id);
    if (wasStaff) {
      db.prepare('UPDATE users SET tokens_valid_after = CURRENT_TIMESTAMP WHERE id = ?').run(target.id);
    }

    res.json({ success: true, message: `${target.email} released to Unassigned` });
  } catch (error) {
    console.error('Lead remove member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
