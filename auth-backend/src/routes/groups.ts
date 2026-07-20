import express, { Request, Response } from 'express';
import { authenticateToken, requireEmailVerified } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import {
  listGroupsWithMeta,
  getGroup,
  getGroupByName,
  countGroupMembers,
  createGroup,
  updateGroup,
  deleteGroup,
  setGroupAreas,
  GroupInvariantError,
} from '../db/groupsRepo.js';
import type { GroupScope } from '../types/group.js';

const router = express.Router();

// Every group-management route is admin-only and requires a verified email.
router.use(authenticateToken, requireEmailVerified, requireAdmin);

function isValidScope(v: unknown): v is GroupScope {
  return v === 'global' || v === 'scoped';
}

function parseGroupId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

type AreaResult = { ok: true; areas: string[] } | { ok: false; error: string };

/**
 * Normalize an incoming areas payload: array of non-empty trimmed strings, strip leading/trailing
 * '/', reject '..' segments, dedupe case-insensitively. Areas are opaque path prefixes; the Flask
 * backend validates that they map to real folders later.
 */
function normalizeAreas(input: unknown): AreaResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'areas must be an array of strings' };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') {
      return { ok: false, error: 'areas must be an array of strings' };
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: false, error: 'areas cannot be empty' };
    }
    const area = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!area) {
      return { ok: false, error: 'areas cannot be empty' };
    }
    if (area.split('/').some((seg) => seg.trim() === '..')) {
      return { ok: false, error: 'areas cannot contain ".." segments' };
    }
    const key = area.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(area);
  }
  return { ok: true, areas: out };
}

// List all groups with their areas and member counts.
router.get('/', (_req: Request, res: Response) => {
  try {
    const groups = listGroupsWithMeta().map((g) => ({
      id: g.id,
      name: g.name,
      scope: g.scope,
      system_key: g.system_key,
      areas: g.areas,
      member_count: g.member_count,
      created_at: g.created_at,
    }));
    res.json({ success: true, groups });
  } catch (error) {
    console.error('List groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a Sub-Area group. system_key cannot be supplied (system groups are seeded, never created here).
router.post('/', (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: unknown; scope?: unknown; system_key?: unknown };

    if (body.system_key != null) {
      res.status(400).json({ error: 'system_key cannot be set' });
      return;
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }

    const scope = body.scope === undefined ? 'scoped' : body.scope;
    if (!isValidScope(scope)) {
      res.status(400).json({ error: "scope must be 'global' or 'scoped'" });
      return;
    }

    if (getGroupByName(name)) {
      res.status(400).json({ error: 'A group with this name already exists' });
      return;
    }

    const group = createGroup(name, scope);
    res.status(201).json({ success: true, group });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rename / re-scope a group. Operations cannot leave 'global'; Primary may flip (the future lever).
router.patch('/:id', (req: Request, res: Response) => {
  try {
    const id = parseGroupId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }
    const group = getGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const body = req.body as { name?: unknown; scope?: unknown };
    const changes: { name?: string; scope?: GroupScope } = {};

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'Group name is required' });
        return;
      }
      const collision = getGroupByName(name);
      if (collision && collision.id !== id) {
        res.status(400).json({ error: 'A group with this name already exists' });
        return;
      }
      changes.name = name;
    }

    if (body.scope !== undefined) {
      if (!isValidScope(body.scope)) {
        res.status(400).json({ error: "scope must be 'global' or 'scoped'" });
        return;
      }
      changes.scope = body.scope;
    }

    if (
      changes.scope !== undefined &&
      changes.scope !== 'global' &&
      group.system_key === 'operations'
    ) {
      res.status(400).json({ error: 'Operations must remain a global-scope group' });
      return;
    }

    const updated = updateGroup(id, changes);
    res.json({ success: true, group: updated });
  } catch (error) {
    if (error instanceof GroupInvariantError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a group. System groups can never be deleted; a group with members returns 409.
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseGroupId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }
    const group = getGroup(id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (group.system_key) {
      res.status(400).json({ error: 'System groups cannot be deleted' });
      return;
    }
    const memberCount = countGroupMembers(id);
    if (memberCount > 0) {
      res.status(409).json({ error: 'Group still has members', member_count: memberCount });
      return;
    }
    deleteGroup(id);
    res.json({ success: true, message: `Group ${group.name} has been deleted` });
  } catch (error) {
    if (error instanceof GroupInvariantError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Replace the group's assigned area path prefixes.
router.put('/:id/areas', (req: Request, res: Response) => {
  try {
    const id = parseGroupId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }
    if (!getGroup(id)) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const normalized = normalizeAreas((req.body as { areas?: unknown }).areas);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error });
      return;
    }
    const areas = setGroupAreas(id, normalized.areas);
    res.json({ success: true, areas });
  } catch (error) {
    console.error('Set group areas error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
