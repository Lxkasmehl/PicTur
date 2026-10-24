/**
 * Research groups (auth backend): group switcher data, platform group management (super admin),
 * member management (group admin) and invitations.
 */

import { apiRequest, type UserRole } from './auth';
import { getToken, TURTLE_API_BASE_URL } from './config';
import { setApiMediaToken } from './orgContext';

export type OrgKind = 'sheets' | 'db';
export type OrgMemberRole = 'staff' | 'admin';

export interface Membership {
  org_id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  role: UserRole;
}

export interface PublicOrg {
  id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  is_default: boolean;
}

export interface Organization extends PublicOrg {
  accepts_community: boolean;
  created_at: string;
  member_count?: number | null;
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
  email: string;
  role: OrgMemberRole;
  expires_at: string;
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || fallback);
  }
  return body as T;
}

export async function getPublicOrgs(): Promise<PublicOrg[]> {
  const r = await apiRequest('/orgs/public');
  return (await json<{ orgs: PublicOrg[] }>(r, 'Failed to load research groups')).orgs;
}

export interface MyOrgs {
  is_super_admin: boolean;
  memberships: Membership[];
  /** Lets <img> URLs load the photos of the user's research groups (see withOrgParam). */
  media_token?: string | null;
}

/** Also stores the returned media token for image URLs. */
export async function getMyOrgs(): Promise<MyOrgs> {
  const r = await apiRequest('/orgs/mine');
  const res = await json<MyOrgs>(r, 'Failed to load your research groups');
  setApiMediaToken(res.media_token ?? null);
  return res;
}

// ---- super admin ----

export interface SuperAdmin {
  id: number;
  email: string;
  name: string | null;
  /** Set in the server configuration (SUPER_ADMIN_EMAILS): cannot be removed in the app. */
  from_env: boolean;
}

export async function listSuperAdmins(): Promise<SuperAdmin[]> {
  const r = await apiRequest('/platform/super-admins');
  return (await json<{ super_admins: SuperAdmin[] }>(r, 'Failed to load super admins')).super_admins;
}

export async function addSuperAdmin(email: string): Promise<SuperAdmin[]> {
  const r = await apiRequest('/platform/super-admins', { method: 'POST', body: JSON.stringify({ email }) });
  return (await json<{ super_admins: SuperAdmin[] }>(r, 'Failed to add super admin')).super_admins;
}

export async function removeSuperAdmin(userId: number): Promise<{ self: boolean; super_admins: SuperAdmin[] }> {
  const r = await apiRequest(`/platform/super-admins/${userId}`, { method: 'DELETE' });
  return json(r, 'Failed to remove super admin');
}

export async function listAllOrgs(): Promise<Organization[]> {
  const r = await apiRequest('/orgs');
  return (await json<{ orgs: Organization[] }>(r, 'Failed to load research groups')).orgs;
}

export async function createOrg(input: {
  name: string;
  slug: string;
  admin_email?: string;
  accepts_community?: boolean;
}): Promise<{ org: Organization; admin: { status: 'added' | 'invited'; email: string } | null }> {
  const r = await apiRequest('/orgs', { method: 'POST', body: JSON.stringify(input) });
  return json(r, 'Failed to create research group');
}

export async function updateOrg(
  orgId: number,
  patch: { name?: string; accepts_community?: boolean },
): Promise<Organization> {
  const r = await apiRequest(`/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return (await json<{ org: Organization }>(r, 'Failed to update research group')).org;
}

/** What a research group holds; anything but zero requires typing its full name to delete it. */
export interface OrgUsage {
  turtle_records: number;
  community_records: number;
  review_queue: number;
  photos: number;
  has_data: boolean;
}

function flaskHeaders(slug: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Org-Slug': slug };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** Super admin: data held by a group (Flask backend, independent of the active group). */
export async function getOrgUsage(slug: string): Promise<OrgUsage> {
  const r = await fetch(`${TURTLE_API_BASE_URL}/org/usage`, { headers: flaskHeaders(slug) });
  return (await json<{ usage: OrgUsage }>(r, 'Failed to load group data')).usage;
}

/**
 * Super admin: delete a group with all its data. `confirmName` (the full group name) is required
 * when the group still holds data.
 */
export async function deleteOrg(slug: string, confirmName?: string): Promise<{ purged: boolean }> {
  const r = await fetch(`${TURTLE_API_BASE_URL}/org`, {
    method: 'DELETE',
    headers: flaskHeaders(slug),
    body: JSON.stringify({ confirm_slug: slug, confirm_name: confirmName ?? '' }),
  });
  return json(r, 'Failed to delete research group');
}

// ---- group admin ----

export async function getOrgMembers(
  orgId: number,
): Promise<{ org: Organization; members: OrgMember[]; invitations: OrgInvitation[] }> {
  const r = await apiRequest(`/orgs/${orgId}/members`);
  return json(r, 'Failed to load members');
}

export async function addOrgMember(
  orgId: number,
  email: string,
  role: OrgMemberRole,
): Promise<{ status: 'added' | 'invited'; email: string }> {
  const r = await apiRequest(`/orgs/${orgId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return json(r, 'Failed to add member');
}

export async function setOrgMemberRole(orgId: number, userId: number, role: OrgMemberRole): Promise<void> {
  const r = await apiRequest(`/orgs/${orgId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  await json(r, 'Failed to change role');
}

export async function removeOrgMember(orgId: number, userId: number): Promise<void> {
  const r = await apiRequest(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
  await json(r, 'Failed to remove member');
}

export async function revokeOrgInvitation(orgId: number, invitationId: number): Promise<void> {
  const r = await apiRequest(`/orgs/${orgId}/invitations/${invitationId}`, { method: 'DELETE' });
  await json(r, 'Failed to revoke invitation');
}

// ---- invitations ----

export interface OrgInvitationDetails {
  email: string;
  role: OrgMemberRole;
  expires_at: string;
  org: PublicOrg;
  has_account: boolean;
}

export async function getOrgInvitation(token: string): Promise<OrgInvitationDetails> {
  const r = await apiRequest(`/orgs/invitations/${encodeURIComponent(token)}`);
  return (await json<{ invitation: OrgInvitationDetails }>(r, 'Invalid or expired invitation')).invitation;
}

export async function acceptOrgInvitation(
  token: string,
): Promise<{ org: PublicOrg; memberships: Membership[] }> {
  const r = await apiRequest('/orgs/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  return json(r, 'Failed to accept invitation');
}
