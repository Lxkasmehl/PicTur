/**
 * Script to create test users for e2e tests
 *
 * Usage:
 *   npm run seed-test-users
 *
 * Or set environment variables (email + password for each seeded user):
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 *   E2E_COMMUNITY_EMAIL / E2E_COMMUNITY_PASSWORD
 *   E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD
 *   E2E_ROLE_TEST_EMAIL / E2E_ROLE_TEST_PASSWORD
 *   E2E_TEAMLEAD_EMAIL / E2E_TEAMLEAD_PASSWORD
 *   E2E_SCOPED_STAFF_EMAIL / E2E_SCOPED_STAFF_PASSWORD
 *   E2E_UNASSIGNED_EMAIL / E2E_UNASSIGNED_PASSWORD
 */

import { seedTestUsers } from './seedTestData.js';

seedTestUsers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error seeding test users:', error);
    process.exit(1);
  });
