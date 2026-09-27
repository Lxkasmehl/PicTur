/**
 * Research groups (organizations) and their memberships.
 *
 * Org 1 ("main") is the original Sheets-backed group. Its membership is implicit: every account
 * belongs to it with users.role. Additional groups are database-backed (kind 'db') and list their
 * staff/admins explicitly in org_memberships.
 */
import crypto from 'crypto';
import db from './database.js';
import type { UserRole } from '../types/user.js';

export const MAIN_ORG_ID = 1;
export const INVITATION_EXPIRY_DAYS = 7;

export type OrgKind = 'sheets' | 'db';
export type OrgMemberRole = 'staff' | 'admin';

export interface Organization {
  id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  accepts_community: boolean;
  is_default: boolean;
  created_at: string;
}

export interface Membership {
  org_id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  role: UserRole;
}

export interface OrgMember {
  id: number;
  email: string;
  name: string | null;
  role: OrgMemberRole;
  created_at: string;
}

export interface OrgInvitation {
  id: number;
  org_id: number;
  email: string;
  role: OrgMemberRole;
  token: string;
  expires_at: string;
  used_at: string | null;
}

interface OrgRow {
  id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  accepts_community: number;
  is_default: number;
  created_at: string;
}

const ORG_COLUMNS = 'id, slug, name, kind, accepts_community, is_default, created_at';
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const ORG_MEMBER_ROLES: OrgMemberRole[] = ['staff', 'admin'];

function toOrg(row: OrgRow): Organization {
  return {
    ...row,
    accepts_community: Boolean(row.accepts_community),
    is_default: Boolean(row.is_default),
  };
}

export function listOrgs(): Organization[] {
  const rows = db.prepare(`SELECT ${ORG_COLUMNS} FROM organizations ORDER BY id`).all() as OrgRow[];
  return rows.map(toOrg);
}

export function listPublicOrgs(): Organization[] {
  return listOrgs().filter((o) => o.accepts_community);
}

export function getOrgById(id: number): Organization | null {
  const row = db.prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`).get(id) as
    | OrgRow
    | undefined;
  return row ? toOrg(row) : null;
}

export function getOrgBySlug(slug: string): Organization | null {
  const row = db.prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = ?`).get(slug) as
    | OrgRow
    | undefined;
  return row ? toOrg(row) : null;
}

/** New groups are always database-backed; only the seeded main group uses Sheets. */
export function createOrg(input: { slug: string; name: string; accepts_community?: boolean }): Organization {
  const result = db
    .prepare(`INSERT INTO organizations (slug, name, kind, accepts_community) VALUES (?, ?, 'db', ?)`)
    .run(input.slug.toLowerCase(), input.name, input.accepts_community === false ? 0 : 1);
  return getOrgById(Number(result.lastInsertRowid)) as Organization;
}

export function updateOrg(
  id: number,
  patch: { name?: string; accepts_community?: boolean }
): Organization | null {
  if (patch.name !== undefined) {
    db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(patch.name, id);
  }
  if (patch.accepts_community !== undefined) {
    db.prepare('UPDATE organizations SET accepts_community = ? WHERE id = ?').run(
      patch.accepts_community ? 1 : 0,
      id
    );
  }
  return getOrgById(id);
}

export function isSuperAdmin(userId: number): boolean {
  const row = db.prepare('SELECT is_super_admin FROM users WHERE id = ?').get(userId) as
    | { is_super_admin: number }
    | undefined;
  return Boolean(row?.is_super_admin);
}

/** All groups the user belongs to; the main group always comes first (role from users.role). */
export function getMembershipsForUser(userId: number): Membership[] {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as
    | { role: UserRole }
    | undefined;
  if (!user) return [];
  const main = getOrgById(MAIN_ORG_ID);
  const out: Membership[] = [];
  if (main) {
    out.push({ org_id: main.id, slug: main.slug, name: main.name, kind: main.kind, role: user.role });
  }
  const rows = db
    .prepare(
      `SELECT o.id AS org_id, o.slug, o.name, o.kind, m.role
       FROM org_memberships m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = ? AND o.id != ? ORDER BY o.name`
    )
    .all(userId, MAIN_ORG_ID) as Membership[];
  return out.concat(rows);
}

/** Effective role of a user in a group. Super admins act as admin everywhere. */
export function getOrgRole(userId: number, orgId: number): UserRole | null {
  if (isSuperAdmin(userId)) return 'admin';
  if (orgId === MAIN_ORG_ID) {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as
      | { role: UserRole }
      | undefined;
    return user?.role ?? null;
  }
  const row = db
    .prepare('SELECT role FROM org_memberships WHERE user_id = ? AND org_id = ?')
    .get(userId, orgId) as { role: OrgMemberRole } | undefined;
  return row?.role ?? null;
}

export function listOrgMembers(orgId: number): OrgMember[] {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, m.role, m.created_at
       FROM org_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? ORDER BY u.email`
    )
    .all(orgId) as OrgMember[];
}

export function upsertMembership(userId: number, orgId: number, role: OrgMemberRole): void {
  db.prepare(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES (?, ?, ?)
     ON CONFLICT(user_id, org_id) DO UPDATE SET role = excluded.role`
  ).run(userId, orgId, role);
}

export function removeMembership(userId: number, orgId: number): boolean {
  const result = db
    .prepare('DELETE FROM org_memberships WHERE user_id = ? AND org_id = ?')
    .run(userId, orgId);
  return result.changes > 0;
}

export function countOrgAdmins(orgId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM org_memberships WHERE org_id = ? AND role = 'admin'`)
    .get(orgId) as { c: number };
  return row.c;
}

export function createInvitation(
  orgId: number,
  email: string,
  role: OrgMemberRole,
  invitedBy: number
): OrgInvitation {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
  // Replace any still-open invitation for the same address so the newest role wins.
  db.prepare('DELETE FROM org_invitations WHERE org_id = ? AND email = ? AND used_at IS NULL').run(
    orgId,
    email.toLowerCase()
  );
  const result = db
    .prepare(
      `INSERT INTO org_invitations (org_id, email, role, token, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(orgId, email.toLowerCase(), role, token, invitedBy, expiresAt.toISOString());
  return db.prepare('SELECT * FROM org_invitations WHERE id = ?').get(
    Number(result.lastInsertRowid)
  ) as OrgInvitation;
}

export function listOpenInvitations(orgId: number): Omit<OrgInvitation, 'token'>[] {
  return db
    .prepare(
      `SELECT id, org_id, email, role, expires_at, used_at FROM org_invitations
       WHERE org_id = ? AND used_at IS NULL AND julianday(expires_at) > julianday('now')
       ORDER BY email`
    )
    .all(orgId) as Omit<OrgInvitation, 'token'>[];
}

export function deleteInvitation(orgId: number, invitationId: number): boolean {
  return (
    db.prepare('DELETE FROM org_invitations WHERE id = ? AND org_id = ?').run(invitationId, orgId)
      .changes > 0
  );
}

export function getActiveInvitation(token: string): OrgInvitation | null {
  const row = db
    .prepare(
      `SELECT * FROM org_invitations
       WHERE token = ? AND used_at IS NULL AND julianday(expires_at) > julianday('now')`
    )
    .get(token) as OrgInvitation | undefined;
  return row ?? null;
}

/**
 * Turns an invitation into a membership. The account's email must match the invited address,
 * which is what proves the invitation reached its owner.
 */
export function acceptInvitation(
  token: string,
  userId: number,
  userEmail: string
): { ok: true; org: Organization } | { ok: false; error: string } {
  const invitation = getActiveInvitation(token);
  if (!invitation) return { ok: false, error: 'Invalid or expired invitation' };
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    return { ok: false, error: 'This invitation was sent to a different email address' };
  }
  const org = getOrgById(invitation.org_id);
  if (!org) return { ok: false, error: 'The research group no longer exists' };
  db.transaction(() => {
    const current = getOrgRole(userId, org.id);
    // Never downgrade an existing admin through an older staff invitation.
    const role: OrgMemberRole = current === 'admin' ? 'admin' : invitation.role;
    upsertMembership(userId, org.id, role);
    db.prepare(`UPDATE org_invitations SET used_at = datetime('now') WHERE id = ?`).run(invitation.id);
  })();
  return { ok: true, org };
}
