/**
 * Repository for groups, group areas, and per-user membership context.
 *
 * Invariants enforced here (belt-and-suspenders for the route layer): system groups cannot be
 * deleted, and the Operations super-group cannot leave 'global' scope. Violations throw
 * GroupInvariantError so callers can map them to a 400.
 */
import db from './database.js';
import type { Group, GroupScope, GroupRole, MembershipContext } from '../types/group.js';

export interface GroupWithMeta extends Group {
  areas: string[];
  member_count: number;
}

/** Thrown when a hard group invariant is violated (delete system group, Operations scope change). */
export class GroupInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupInvariantError';
  }
}

const GROUP_COLUMNS = 'id, name, scope, system_key, created_at, updated_at';

export function getGroup(id: number): Group | null {
  const row = db.prepare(`SELECT ${GROUP_COLUMNS} FROM groups WHERE id = ?`).get(id) as
    | Group
    | undefined;
  return row ?? null;
}

export function getGroupByName(name: string): Group | null {
  const row = db
    .prepare(`SELECT ${GROUP_COLUMNS} FROM groups WHERE name = ? COLLATE NOCASE`)
    .get(name) as Group | undefined;
  return row ?? null;
}

export function getGroupBySystemKey(key: string): Group | null {
  const row = db
    .prepare(`SELECT ${GROUP_COLUMNS} FROM groups WHERE system_key = ?`)
    .get(key) as Group | undefined;
  return row ?? null;
}

export function getGroupAreas(id: number): string[] {
  const rows = db
    .prepare('SELECT area FROM group_areas WHERE group_id = ? ORDER BY area COLLATE NOCASE')
    .all(id) as { area: string }[];
  return rows.map((r) => r.area);
}

export function countGroupMembers(id: number): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users WHERE group_id = ?').get(id) as {
    c: number;
  };
  return row.c;
}

export function listGroupsWithMeta(): GroupWithMeta[] {
  const groups = db
    .prepare(`SELECT ${GROUP_COLUMNS} FROM groups ORDER BY (system_key IS NULL) ASC, name COLLATE NOCASE ASC`)
    .all() as Group[];
  return groups.map((g) => ({
    ...g,
    areas: getGroupAreas(g.id),
    member_count: countGroupMembers(g.id),
  }));
}

export function createGroup(name: string, scope: GroupScope): Group {
  const info = db.prepare('INSERT INTO groups (name, scope) VALUES (?, ?)').run(name, scope);
  const created = getGroup(Number(info.lastInsertRowid));
  if (!created) {
    throw new Error('Failed to load group after creation');
  }
  return created;
}

export function updateGroup(id: number, changes: { name?: string; scope?: GroupScope }): Group {
  const group = getGroup(id);
  if (!group) {
    throw new GroupInvariantError('Group not found');
  }
  // Operations must always stay global-scope. Primary and Sub-Area groups may flip freely.
  if (
    changes.scope !== undefined &&
    changes.scope !== 'global' &&
    group.system_key === 'operations'
  ) {
    throw new GroupInvariantError('Operations must remain a global-scope group');
  }
  const nextName = changes.name !== undefined ? changes.name : group.name;
  const nextScope = changes.scope !== undefined ? changes.scope : group.scope;
  db.prepare(`UPDATE groups SET name = ?, scope = ?, updated_at = datetime('now') WHERE id = ?`).run(
    nextName,
    nextScope,
    id
  );
  const updated = getGroup(id);
  if (!updated) {
    throw new Error('Failed to load group after update');
  }
  return updated;
}

export function deleteGroup(id: number): void {
  const group = getGroup(id);
  if (!group) {
    throw new GroupInvariantError('Group not found');
  }
  if (group.system_key) {
    throw new GroupInvariantError('System groups cannot be deleted');
  }
  // ON DELETE CASCADE clears group_areas rows for this group.
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

/** Replace-set the group's areas. Input is assumed already validated/normalized by the caller. */
export function setGroupAreas(id: number, areas: string[]): string[] {
  const replace = db.transaction((groupId: number, list: string[]) => {
    db.prepare('DELETE FROM group_areas WHERE group_id = ?').run(groupId);
    const insert = db.prepare('INSERT INTO group_areas (group_id, area) VALUES (?, ?)');
    for (const area of list) {
      insert.run(groupId, area);
    }
  });
  replace(id, areas);
  return getGroupAreas(id);
}

/**
 * Resolve a user's membership for the enriched /auth payloads. areas is [] for a global-scope
 * group, an unassigned user, a dangling group_id, or a scoped group with no areas assigned.
 */
export function getMembershipContext(userId: number): MembershipContext {
  const user = db.prepare('SELECT group_id, group_role FROM users WHERE id = ?').get(userId) as
    | { group_id: number | null; group_role: GroupRole }
    | undefined;
  if (!user) {
    return { group: null, group_role: 'member', areas: [] };
  }
  const groupRole: GroupRole = user.group_role === 'lead' ? 'lead' : 'member';
  if (user.group_id == null) {
    return { group: null, group_role: groupRole, areas: [] };
  }
  const group = getGroup(user.group_id);
  if (!group) {
    // group_id points at a deleted group (no DB FK) — treat as unassigned.
    return { group: null, group_role: groupRole, areas: [] };
  }
  return {
    group: { id: group.id, name: group.name, scope: group.scope, system_key: group.system_key },
    group_role: groupRole,
    areas: group.scope === 'global' ? [] : getGroupAreas(group.id),
  };
}
