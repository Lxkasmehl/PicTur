/**
 * Auth persistence: SQLite (auth.sqlite). One-time import from legacy auth.json if DB is empty.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import type { CommunityGamePersistedPayload } from '../types/communityGame.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'auth.sqlite');
const legacyJsonPath = path.join(dataDir, 'auth.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function initSchema(database: Database): void {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT,
      name TEXT,
      google_id TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'community' CHECK (role IN ('community', 'staff', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,
      tokens_valid_after TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS community_game (
      user_id INTEGER NOT NULL PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
  `);
}

/** Existing SQLite DBs created before used_at: add column for idempotent verify-email. */
function migrateEmailVerificationsUsedAt(database: Database): void {
  const cols = database.prepare(`PRAGMA table_info(email_verifications)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'used_at')) {
    database.exec(`ALTER TABLE email_verifications ADD COLUMN used_at TEXT`);
  }
}

function setAutoincrementSeq(database: Database, table: string, maxId: number): void {
  if (maxId < 1) return;
  try {
    database.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
    database.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, maxId);
  } catch (e) {
    console.warn(`Could not update sqlite_sequence for ${table} (non-fatal):`, e);
  }
}

interface LegacyJsonDb {
  users?: Array<{
    id: number;
    email: string;
    password_hash?: string;
    name: string | null;
    google_id: string | null;
    role: string;
    created_at: string;
    updated_at: string;
    email_verified?: boolean;
    email_verified_at: string | null;
    tokens_valid_after?: string | null;
  }>;
  admin_invitations?: Array<{
    id: number;
    email: string;
    token: string;
    created_at: string;
    expires_at: string;
    used: boolean;
  }>;
  email_verifications?: Array<{
    id: number;
    user_id: number;
    token: string;
    expires_at: string;
  }>;
  community_game_states?: Array<{
    user_id: number;
    updated_at: string;
    data: CommunityGamePersistedPayload;
  }>;
}

function maybeMigrateLegacyJson(database: Database): void {
  if (!fs.existsSync(legacyJsonPath)) {
    return;
  }
  const row = database.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (row.c > 0) {
    return;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(legacyJsonPath, 'utf-8');
  } catch {
    return;
  }

  let j: LegacyJsonDb;
  try {
    j = JSON.parse(raw) as LegacyJsonDb;
  } catch {
    console.error('Legacy auth.json exists but is not valid JSON; skipping migration.');
    return;
  }

  console.log('📦 Migrating auth.json → SQLite (auth.sqlite)…');

  const migrate = database.transaction(() => {
    let maxUser = 0;
    for (const u of j.users ?? []) {
      // Pre–verification-feature auth.json omitted email_verified; treat absent as verified (same as legacy JSON backfill).
      const migratedVerified = u.email_verified !== false;
      const migratedVerifiedAt = migratedVerified
        ? (u.email_verified_at ?? u.updated_at ?? u.created_at)
        : null;
      database
        .prepare(
          `INSERT INTO users (id, email, password_hash, name, google_id, role, created_at, updated_at, email_verified, email_verified_at, tokens_valid_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          u.id,
          String(u.email).toLowerCase(),
          u.password_hash ?? null,
          u.name ?? null,
          u.google_id ?? null,
          u.role,
          u.created_at,
          u.updated_at,
          migratedVerified ? 1 : 0,
          migratedVerifiedAt,
          u.tokens_valid_after ?? null
        );
      maxUser = Math.max(maxUser, u.id);
    }
    setAutoincrementSeq(database, 'users', maxUser);

    let maxInv = 0;
    for (const inv of j.admin_invitations ?? []) {
      database
        .prepare(
          `INSERT INTO admin_invitations (id, email, token, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(inv.id, inv.email, inv.token, inv.created_at, inv.expires_at, inv.used ? 1 : 0);
      maxInv = Math.max(maxInv, inv.id);
    }
    setAutoincrementSeq(database, 'admin_invitations', maxInv);

    let maxEv = 0;
    for (const ev of j.email_verifications ?? []) {
      database
        .prepare(
          `INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
        )
        .run(ev.id, ev.user_id, ev.token, ev.expires_at);
      maxEv = Math.max(maxEv, ev.id);
    }
    setAutoincrementSeq(database, 'email_verifications', maxEv);

    for (const cg of j.community_game_states ?? []) {
      database
        .prepare(
          `INSERT INTO community_game (user_id, data, updated_at) VALUES (?, ?, ?)`
        )
        .run(cg.user_id, JSON.stringify(cg.data), cg.updated_at);
    }
  });

  migrate();

  const bak = `${legacyJsonPath}.migrated.${Date.now()}.bak`;
  try {
    fs.renameSync(legacyJsonPath, bak);
    console.log(`✅ Migration done. Legacy file renamed to ${path.basename(bak)}`);
  } catch (e) {
    console.warn('Could not rename auth.json after migration; you may remove it manually.', e);
  }
}

const db: Database = new BetterSqlite3(dbPath);
initSchema(db);
migrateEmailVerificationsUsedAt(db);
maybeMigrateLegacyJson(db);

export function getCommunityGameForUser(userId: number): CommunityGamePersistedPayload | null {
  const row = db
    .prepare('SELECT data FROM community_game WHERE user_id = ?')
    .get(userId) as { data: string } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as CommunityGamePersistedPayload;
  } catch {
    return null;
  }
}

export function saveCommunityGameForUser(
  userId: number,
  data: CommunityGamePersistedPayload
): void {
  const now = new Date().toISOString();
  const payload = JSON.stringify(data);
  db.prepare(
    `INSERT INTO community_game (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(userId, payload, now);
}

export default db;
