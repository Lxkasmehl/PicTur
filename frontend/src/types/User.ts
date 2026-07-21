/** community (default) | staff (admin-like, no user management) | admin (full) */
export type UserRole = 'community' | 'staff' | 'admin';

/** Group scope: global (Operations/Primary — unscoped access) | scoped (Sub-Area, area-limited). */
export type GroupScope = 'global' | 'scoped';

/** Membership rank within a group; 'lead' marks a Team Lead (staff only). */
export type GroupRole = 'member' | 'lead';

/**
 * A user's resolved group membership (null = unassigned). Mirrors the auth backend's
 * MembershipContext.group shape on the enriched /auth/me and /auth/validate payloads.
 */
export interface UserGroup {
  id: number;
  name: string;
  scope: GroupScope;
  system_key: string | null;
}
