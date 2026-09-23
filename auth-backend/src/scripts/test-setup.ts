/**
 * Test setup script that seeds test users and then exits so the next command (npm run dev) can run.
 * Used by Playwright (`npm run test:dev`) to ensure test users exist before the server starts.
 */

import { seedTestUsers } from './seedTestData.js';

seedTestUsers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error seeding test users:', error);
    process.exit(1);
  });
