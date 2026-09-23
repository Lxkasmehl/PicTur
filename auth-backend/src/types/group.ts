/**
 * Groups + membership metadata.
 *
 * Three tiers: Operations (system super-group, always global, holds admins), Primary (system
 * group, global today but flippable to scoped later), and admin-created Sub-Area groups (scoped,
 * with area path prefixes). Roles stay community|staff|admin; a Team Lead is a staff user whose
 * membership carries group_role='lead'. Unassigned users have group_id = NULL.
 */
export type GroupScope = 'global' | 'scoped';
export type GroupRole = 'member' | 'lead';

export interface Group {
  id: number;
  name: string;
  scope: GroupScope;
  system_key: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A user's resolved membership, attached to the enriched /auth/validate and /auth/me payloads.
 * areas is [] when the group is global-scope, when the user is unassigned, or when no areas are set.
 */
export interface MembershipContext {
  group: Pick<Group, 'id' | 'name' | 'scope' | 'system_key'> | null;
  group_role: GroupRole;
  areas: string[];
}
