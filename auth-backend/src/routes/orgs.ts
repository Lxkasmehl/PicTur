/**
 * Research groups (organizations): platform-level management by super admins, member management
 * by group admins, and invitation acceptance.
 *
 * Members of the main (Sheets-backed) group keep being managed through /api/admin/users; these
 * member endpoints only apply to the database-backed groups.
 */
import express, { Request, Response } from 'express';
import db from '../db/database.js';
import {
  MAIN_ORG_ID,
  ORG_MEMBER_ROLES,
  SLUG_PATTERN,
  acceptInvitation,
  countOrgAdmins,
  createInvitation,
  createOrg,
  deleteInvitation,
  getActiveInvitation,
  getMembershipsForUser,
  getOrgById,
  getOrgBySlug,
  isSuperAdmin,
  listOpenInvitations,
  listOrgMembers,
  listOrgs,
  listPublicOrgs,
  removeMembership,
  updateOrg,
  upsertMembership,
  type OrgMemberRole,
  type Organization,
} from '../db/orgsRepo.js';
import { authenticateToken, AuthRequest, requireEmailVerified } from '../middleware/auth.js';
import { requireOrgRole, requireSuperAdmin } from '../middleware/admin.js';
import { sendOrgInvitationEmail } from '../services/email.js';

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicOrg(o: Organization) {
  return { id: o.id, slug: o.slug, name: o.name, kind: o.kind, is_default: o.is_default };
}

function rejectMainOrg(res: Response): boolean {
  const org = res.locals.org as Organization;
  if (org.id === MAIN_ORG_ID) {
    res.status(400).json({
      error: 'Members of the main research group are managed in the regular user management.',
    });
    return true;
  }
  return false;
}

/**
 * Adds `email` to the group: existing accounts become members right away, unknown addresses get
 * an emailed invitation.
 */
async function addOrInvite(
  org: Organization,
  email: string,
  role: OrgMemberRole,
  invitedBy: number
): Promise<{ status: 'added' | 'invited'; email: string; role: OrgMemberRole }> {
  const normalized = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as
    | { id: number }
    | undefined;
  if (existing) {
    upsertMembership(existing.id, org.id, role);
    await sendOrgInvitationEmail({ email: normalized, orgName: org.name, role, hasAccount: true });
    return { status: 'added', email: normalized, role };
  }
  const invitation = createInvitation(org.id, normalized, role, invitedBy);
  await sendOrgInvitationEmail({
    email: normalized,
    orgName: org.name,
    role,
    hasAccount: false,
    invitationToken: invitation.token,
  });
  return { status: 'invited', email: normalized, role };
}

function parseMemberRole(value: unknown): OrgMemberRole | null {
  return ORG_MEMBER_ROLES.includes(value as OrgMemberRole) ? (value as OrgMemberRole) : null;
}

// Groups that accept community uploads (upload page group picker). Public.
router.get('/public', (_req: Request, res: Response) => {
  res.json({ success: true, orgs: listPublicOrgs().map(publicOrg) });
});

// Groups of the current user (group switcher).
router.get('/mine', authenticateToken, (req: Request, res: Response) => {
  const authUser = (req as AuthRequest).user!;
  res.json({
    success: true,
    is_super_admin: isSuperAdmin(authUser.id),
    memberships: getMembershipsForUser(authUser.id),
  });
});

// Invitation details for the accept-invite page. Public; the token is the secret.
router.get('/invitations/:token', (req: Request, res: Response) => {
  const invitation = getActiveInvitation(req.params.token);
  const org = invitation ? getOrgById(invitation.org_id) : null;
  if (!invitation || !org) {
    res.status(404).json({ error: 'Invalid or expired invitation' });
    return;
  }
  const hasAccount = Boolean(
    db.prepare('SELECT id FROM users WHERE email = ?').get(invitation.email.toLowerCase())
  );
  res.json({
    success: true,
    invitation: {
      email: invitation.email,
      role: invitation.role,
      expires_at: invitation.expires_at,
      org: publicOrg(org),
      has_account: hasAccount,
    },
  });
});

// Accept an invitation with the logged-in account (email must match the invited address).
router.post('/invitations/accept', authenticateToken, (req: Request, res: Response) => {
  const authUser = (req as AuthRequest).user!;
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) {
    res.status(400).json({ error: 'Invitation token is required' });
    return;
  }
  const result = acceptInvitation(token, authUser.id, authUser.email);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({
    success: true,
    org: publicOrg(result.org),
    memberships: getMembershipsForUser(authUser.id),
  });
});

// ---- Super admin: group management ----

router.get('/', authenticateToken, requireSuperAdmin, (_req: Request, res: Response) => {
  const counts = db
    .prepare(`SELECT org_id, COUNT(*) AS c FROM org_memberships GROUP BY org_id`)
    .all() as { org_id: number; c: number }[];
  const byOrg = new Map(counts.map((r) => [r.org_id, r.c]));
  res.json({
    success: true,
    orgs: listOrgs().map((o) => ({
      ...o,
      member_count: o.id === MAIN_ORG_ID ? null : byOrg.get(o.id) ?? 0,
    })),
  });
});

router.post(
  '/',
  authenticateToken,
  requireEmailVerified,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    try {
      const authUser = (req as AuthRequest).user!;
      const { slug, name, accepts_community, admin_email } = req.body ?? {};
      const cleanName = typeof name === 'string' ? name.trim() : '';
      const cleanSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
      if (!cleanName || cleanName.length > 120) {
        res.status(400).json({ error: 'Name is required (max 120 characters)' });
        return;
      }
      if (!SLUG_PATTERN.test(cleanSlug)) {
        res.status(400).json({
          error: 'Slug must be 1-40 lowercase letters, digits or dashes (no leading/trailing dash)',
        });
        return;
      }
      if (getOrgBySlug(cleanSlug)) {
        res.status(409).json({ error: 'A research group with this slug already exists' });
        return;
      }
      if (admin_email !== undefined && admin_email !== '' && !EMAIL_PATTERN.test(String(admin_email))) {
        res.status(400).json({ error: 'Admin email is not a valid email address' });
        return;
      }
      const org = createOrg({
        slug: cleanSlug,
        name: cleanName,
        accepts_community: accepts_community !== false,
      });
      const admin = admin_email
        ? await addOrInvite(org, String(admin_email), 'admin', authUser.id)
        : null;
      res.status(201).json({ success: true, org, admin });
    } catch (error) {
      console.error('Create org error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Rename / toggle community uploads. Group admins may edit their own group; main only by super admin.
router.patch(
  '/:orgId',
  authenticateToken,
  requireEmailVerified,
  requireOrgRole(['admin']),
  (req: Request, res: Response) => {
    const authUser = (req as AuthRequest).user!;
    const org = res.locals.org as Organization;
    if (org.id === MAIN_ORG_ID && !isSuperAdmin(authUser.id)) {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }
    const { name, accepts_community } = req.body ?? {};
    const patch: { name?: string; accepts_community?: boolean } = {};
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName || cleanName.length > 120) {
        res.status(400).json({ error: 'Name is required (max 120 characters)' });
        return;
      }
      patch.name = cleanName;
    }
    if (accepts_community !== undefined) patch.accepts_community = Boolean(accepts_community);
    res.json({ success: true, org: updateOrg(org.id, patch) });
  }
);

// ---- Group admins: members + invitations ----

router.get(
  '/:orgId/members',
  authenticateToken,
  requireOrgRole(['admin']),
  (_req: Request, res: Response) => {
    if (rejectMainOrg(res)) return;
    const org = res.locals.org as Organization;
    res.json({
      success: true,
      org,
      members: listOrgMembers(org.id),
      invitations: listOpenInvitations(org.id),
    });
  }
);

router.post(
  '/:orgId/members',
  authenticateToken,
  requireEmailVerified,
  requireOrgRole(['admin']),
  async (req: Request, res: Response) => {
    try {
      if (rejectMainOrg(res)) return;
      const authUser = (req as AuthRequest).user!;
      const org = res.locals.org as Organization;
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const role = parseMemberRole(req.body?.role ?? 'staff');
      if (!EMAIL_PATTERN.test(email)) {
        res.status(400).json({ error: 'A valid email address is required' });
        return;
      }
      if (!role) {
        res.status(400).json({ error: `Role must be one of: ${ORG_MEMBER_ROLES.join(', ')}` });
        return;
      }
      const result = await addOrInvite(org, email, role, authUser.id);
      res.status(result.status === 'added' ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      console.error('Add org member error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.patch(
  '/:orgId/members/:userId',
  authenticateToken,
  requireEmailVerified,
  requireOrgRole(['admin']),
  (req: Request, res: Response) => {
    if (rejectMainOrg(res)) return;
    const authUser = (req as AuthRequest).user!;
    const org = res.locals.org as Organization;
    const userId = Number(req.params.userId);
    const role = parseMemberRole(req.body?.role);
    if (!role) {
      res.status(400).json({ error: `Role must be one of: ${ORG_MEMBER_ROLES.join(', ')}` });
      return;
    }
    const current = db
      .prepare('SELECT role FROM org_memberships WHERE user_id = ? AND org_id = ?')
      .get(userId, org.id) as { role: OrgMemberRole } | undefined;
    if (!current) {
      res.status(404).json({ error: 'User is not a member of this research group' });
      return;
    }
    if (
      current.role === 'admin' &&
      role !== 'admin' &&
      countOrgAdmins(org.id) <= 1 &&
      !isSuperAdmin(authUser.id)
    ) {
      res.status(400).json({ error: 'Cannot demote the last admin of this research group.' });
      return;
    }
    upsertMembership(userId, org.id, role);
    res.json({ success: true, user_id: userId, role });
  }
);

router.delete(
  '/:orgId/members/:userId',
  authenticateToken,
  requireEmailVerified,
  requireOrgRole(['admin']),
  (req: Request, res: Response) => {
    if (rejectMainOrg(res)) return;
    const authUser = (req as AuthRequest).user!;
    const org = res.locals.org as Organization;
    const userId = Number(req.params.userId);
    const current = db
      .prepare('SELECT role FROM org_memberships WHERE user_id = ? AND org_id = ?')
      .get(userId, org.id) as { role: OrgMemberRole } | undefined;
    if (current?.role === 'admin' && countOrgAdmins(org.id) <= 1 && !isSuperAdmin(authUser.id)) {
      res.status(400).json({ error: 'Cannot remove the last admin of this research group.' });
      return;
    }
    if (!removeMembership(userId, org.id)) {
      res.status(404).json({ error: 'User is not a member of this research group' });
      return;
    }
    res.json({ success: true });
  }
);

router.delete(
  '/:orgId/invitations/:invitationId',
  authenticateToken,
  requireEmailVerified,
  requireOrgRole(['admin']),
  (req: Request, res: Response) => {
    const org = res.locals.org as Organization;
    if (!deleteInvitation(org.id, Number(req.params.invitationId))) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }
    res.json({ success: true });
  }
);

export default router;
