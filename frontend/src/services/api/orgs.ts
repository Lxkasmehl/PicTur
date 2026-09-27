/**
 * Research groups (auth backend): group switcher data, platform group management (super admin),
 * member management (group admin) and invitations.
 */

import { apiRequest, type UserRole } from './auth';

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

export async function getMyOrgs(): Promise<{ is_super_admin: boolean; memberships: Membership[] }> {
  const r = await apiRequest('/orgs/mine');
  return json(r, 'Failed to load your research groups');
}

// ---- super admin ----

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
