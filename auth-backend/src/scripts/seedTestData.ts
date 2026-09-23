/**
 * Shared e2e/integration seed logic used by both `seed-test-users.ts` and `test-setup.ts`.
 *
 * Seeds the four base users (admin/community/staff/role-test), a scoped group `KansasTeam` whose one
 * area maps to a real fixture-data folder, and three group-aware users (team lead, scoped staff,
 * unassigned community). The base admin/staff are routed into the Operations/Primary system groups
 * by the shared backfill migration rather than being assigned here, so their membership matches a
 * real production boot.
 */
import db, { migrateBackfillMembership } from '../db/database.js';
import bcrypt from 'bcryptjs';
import { getGroupByName, createGroup, setGroupAreas } from '../db/groupsRepo.js';
import type { GroupRole } from '../types/group.js';
import type { User } from '../types/user.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@test.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'testpassword123';
const communityEmail = process.env.E2E_COMMUNITY_EMAIL || 'community@test.com';
const communityPassword = process.env.E2E_COMMUNITY_PASSWORD || 'testpassword123';
const staffEmail = process.env.E2E_STAFF_EMAIL || 'staff@test.com';
const staffPassword = process.env.E2E_STAFF_PASSWORD || 'testpassword123';
const roleTestEmail = process.env.E2E_ROLE_TEST_EMAIL || 'role-test-community@test.com';
const roleTestPassword = process.env.E2E_ROLE_TEST_PASSWORD || 'testpassword123';

const teamLeadEmail = process.env.E2E_TEAMLEAD_EMAIL || 'teamlead@test.com';
const teamLeadPassword = process.env.E2E_TEAMLEAD_PASSWORD || 'testpassword123';
const scopedStaffEmail = process.env.E2E_SCOPED_STAFF_EMAIL || 'scoped-staff@test.com';
const scopedStaffPassword = process.env.E2E_SCOPED_STAFF_PASSWORD || 'testpassword123';
const unassignedEmail = process.env.E2E_UNASSIGNED_EMAIL || 'unassigned@test.com';
const unassignedPassword = process.env.E2E_UNASSIGNED_PASSWORD || 'testpassword123';

// KansasTeam's single area. Must map to a real folder under backend/tests/fixture-data so PR-2's
// Flask area enforcement resolves it; `Kansas/Topeka` exists there.
const KANSAS_TEAM_NAME = 'KansasTeam';
const KANSAS_TEAM_AREA = 'Kansas/Topeka';

/** Create or refresh a base user (password + role + verification). Group membership is untouched. */
export async function createUser(
  email: string,
  password: string,
  role: 'admin' | 'staff' | 'community',
  name: string | null = null
): Promise<void> {
  const existingUser = db
    .prepare('SELECT id, role FROM users WHERE email = ?')
    .get(email.toLowerCase()) as User | undefined;

  if (existingUser) {
    // Always set password and role to seed values so e2e credentials work regardless of prior state.
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare(
      'UPDATE users SET password_hash = ?, role = ?, email_verified = ?, email_verified_at = ?, updated_at = ? WHERE id = ?'
    ).run(passwordHash, role, 1, now, now, existingUser.id);
    console.log(`✅ User ${email} updated (password + role) for e2e`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db
    .prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run(email.toLowerCase(), passwordHash, name, role);

  const now = new Date().toISOString();
  const newId = Number(result.lastInsertRowid);
  db.prepare(
    'UPDATE users SET email_verified = ?, email_verified_at = ?, updated_at = ? WHERE id = ?'
  ).run(1, now, now, newId);

  console.log(`✅ Created ${role} user: ${email} (ID: ${newId})`);
}

/** Ensure a scoped group with exactly the given single area exists; returns its id. Idempotent. */
function ensureScopedGroupWithArea(name: string, area: string): number {
  let group = getGroupByName(name);
  if (!group) {
    group = createGroup(name, 'scoped');
    console.log(`✅ Created group: ${name} (scoped)`);
  }
  setGroupAreas(group.id, [area]);
  return group.id;
}

/** Create or refresh a group-aware user (password + role + verification + explicit membership). */
async function upsertUserWithMembership(
  email: string,
  password: string,
  role: 'staff' | 'community',
  name: string | null,
  groupId: number | null,
  groupRole: GroupRole
): Promise<void> {
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email.toLowerCase()) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE users SET password_hash = ?, role = ?, email_verified = 1, email_verified_at = ?, group_id = ?, group_role = ?, updated_at = ? WHERE id = ?'
    ).run(passwordHash, role, now, groupId, groupRole, now, existing.id);
    console.log(`✅ User ${email} updated (membership) for e2e`);
    return;
  }

  const result = db
    .prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run(email.toLowerCase(), passwordHash, name, role);
  const newId = Number(result.lastInsertRowid);
  db.prepare(
    'UPDATE users SET email_verified = 1, email_verified_at = ?, group_id = ?, group_role = ?, updated_at = ? WHERE id = ?'
  ).run(now, groupId, groupRole, now, newId);
  console.log(`✅ Created ${role} user: ${email} (group ${groupId ?? 'none'}, ${groupRole})`);
}

/** Seed all e2e users, the KansasTeam group, and backfill the base admin/staff into system groups. */
export async function seedTestUsers(): Promise<void> {
  console.log('🌱 Seeding test users for e2e tests...\n');

  // Base users (roles only; system-group membership comes from the backfill below).
  await createUser(adminEmail, adminPassword, 'admin', 'Test Admin');
  await createUser(communityEmail, communityPassword, 'community', 'Test Community');
  await createUser(staffEmail, staffPassword, 'staff', 'Test Staff');
  // Dedicated user for "change role" e2e/integration tests (never community@test.com).
  await createUser(roleTestEmail, roleTestPassword, 'community', 'Role Test');

  // Scoped Sub-Area group + its members.
  const kansasTeamId = ensureScopedGroupWithArea(KANSAS_TEAM_NAME, KANSAS_TEAM_AREA);
  await upsertUserWithMembership(
    teamLeadEmail,
    teamLeadPassword,
    'staff',
    'Test Team Lead',
    kansasTeamId,
    'lead'
  );
  await upsertUserWithMembership(
    scopedStaffEmail,
    scopedStaffPassword,
    'staff',
    'Test Scoped Staff',
    kansasTeamId,
    'member'
  );
  await upsertUserWithMembership(
    unassignedEmail,
    unassignedPassword,
    'community',
    'Test Unassigned',
    null,
    'member'
  );

  // Route the freshly-created base admin/staff into Operations/Primary. The module-init backfill runs
  // before these rows exist (migrations run at import), so re-run it here to assign them in one pass.
  migrateBackfillMembership(db);

  console.log('\n✅ Test users seeded successfully!');
  console.log(`   Admin: ${adminEmail} (→ Operations)`);
  console.log(`   Staff: ${staffEmail} (→ Primary)`);
  console.log(`   Community: ${communityEmail}`);
  console.log(`   Role test (community): ${roleTestEmail}`);
  console.log(`   Team lead: ${teamLeadEmail} (→ ${KANSAS_TEAM_NAME}, lead)`);
  console.log(`   Scoped staff: ${scopedStaffEmail} (→ ${KANSAS_TEAM_NAME}, member)`);
  console.log(`   Unassigned: ${unassignedEmail}`);
  console.log(`   Password: ${adminPassword} (same for all)\n`);
}
