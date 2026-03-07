// Simple JSON-based database for development (no build tools required)
// This works on Windows without admin rights
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
try {
  mkdirSync(dataDir, { recursive: true });
} catch (error) {
  // Directory might already exist, ignore error
}

const dbPath = path.join(dataDir, 'auth.json');

interface User {
  id: number;
  email: string;
  password_hash?: string;
  name: string | null;
  google_id: string | null;
  role: 'community' | 'admin';
  created_at: string;
  updated_at: string;
  email_verified: boolean;
  email_verified_at: string | null;
}

interface AdminInvitation {
  id: number;
  email: string;
  token: string;
  created_at: string;
  expires_at: string;
  used: boolean;
}

interface EmailVerification {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
}

interface Database {
  users: User[];
  admin_invitations: AdminInvitation[];
  email_verifications: EmailVerification[];
  nextId: number;
  nextInvitationId: number;
  nextVerificationId: number;
}

// Load or create database
function loadDatabase(): Database {
  if (existsSync(dbPath)) {
    try {
      const data = readFileSync(dbPath, 'utf-8');
      const db = JSON.parse(data);
      // Ensure new fields exist for backward compatibility
      if (!db.admin_invitations) {
        db.admin_invitations = [];
      }
      if (!db.nextInvitationId) {
        db.nextInvitationId = 1;
      }
      if (!db.email_verifications) {
        db.email_verifications = [];
      }
      if (!db.nextVerificationId) {
        db.nextVerificationId = 1;
      }
      // Migrate existing users: add email_verified / email_verified_at (existing users count as verified)
      if (db.users && Array.isArray(db.users)) {
        db.users.forEach((u: any) => {
          if (u.email_verified === undefined) {
            u.email_verified = true;
            u.email_verified_at = u.email_verified_at ?? u.created_at ?? new Date().toISOString();
          }
          if (u.email_verified_at === undefined) {
            u.email_verified_at = u.email_verified ? (u.created_at ?? null) : null;
          }
        });
      }
      return db;
    } catch (error) {
      console.error('Error loading database, creating new one:', error);
    }
  }

  return {
    users: [],
    admin_invitations: [],
    email_verifications: [],
    nextId: 1,
    nextInvitationId: 1,
    nextVerificationId: 1,
  };
}

// Save database
function saveDatabase(db: Database): void {
  writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

let database = loadDatabase();

// Wrapper to match better-sqlite3 API
class DatabaseWrapper {
  prepare(sql: string) {
    return {
      get: (...params: any[]) => {
        return this.executeQuery(sql, params, 'get');
      },
      run: (...params: any[]) => {
        return this.executeQuery(sql, params, 'run');
      },
      all: (...params: any[]) => {
        return this.executeQuery(sql, params, 'all');
      },
    };
  }

  private executeQuery(sql: string, params: any[], mode: 'get' | 'run' | 'all'): any {
    const upperSql = sql.trim().toUpperCase();

    // SELECT queries
    if (upperSql.startsWith('SELECT')) {
      // Reload database to ensure we have the latest data
      database = loadDatabase();

      // Determine which table to query
      let tableName = 'users';
      if (sql.includes('FROM admin_invitations')) {
        tableName = 'admin_invitations';
      } else if (sql.includes('FROM email_verifications')) {
        tableName = 'email_verifications';
      } else if (sql.includes('FROM users')) {
        tableName = 'users';
      }

      let results: any[] = [];
      if (tableName === 'users') {
        results = [...database.users];
      } else if (tableName === 'admin_invitations') {
        results = [...(database.admin_invitations || [])];
      } else if (tableName === 'email_verifications') {
        results = [...(database.email_verifications || [])];
      }

      // WHERE clause parsing - supports multiple conditions with AND
      if (sql.includes('WHERE')) {
        const whereClause = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s*$)/i)?.[1];
        if (whereClause) {
          // Split by AND to handle multiple conditions
          const conditions = whereClause.split(/\s+AND\s+/i).map((c) => c.trim());
          let paramIndex = 0;

          // Extract parameter indices for each condition (once, before filtering)
          const conditionParams: Array<{ column: string; paramIndex: number }> = [];
          conditions.forEach((condition) => {
            const eqMatch = condition.match(/(\w+)\s*=\s*\?/i);
            if (eqMatch) {
              conditionParams.push({ column: eqMatch[1], paramIndex: paramIndex++ });
            }
          });

          // Reset paramIndex for actual filtering
          paramIndex = 0;

          results = results.filter((row: any) => {
            return conditionParams.every(({ column, paramIndex: paramIdx }) => {
              const value = params[paramIdx];
              const rowValue = row[column];

              // Handle null comparisons
              if (value === null || value === undefined) {
                return rowValue === null || rowValue === undefined;
              }
              if (rowValue === null || rowValue === undefined) {
                return false;
              }

              // Case-insensitive comparison for email
              if (
                column === 'email' &&
                typeof rowValue === 'string' &&
                typeof value === 'string'
              ) {
                return rowValue.toLowerCase() === value.toLowerCase();
              }

              // String comparison for google_id (always compare as strings)
              if (column === 'google_id') {
                return String(rowValue) === String(value);
              }

              // Handle type coercion for ID comparisons (number vs string)
              const matches =
                rowValue === value ||
                String(rowValue) === String(value) ||
                (Number(rowValue) === Number(value) &&
                  !isNaN(Number(rowValue)) &&
                  !isNaN(Number(value)));
              return matches;
            });
          });

          // Handle other condition types (like datetime comparisons, boolean checks, etc.)
          // These need to be applied in addition to the parameterized conditions
          const otherConditions = conditions.filter((c) => !c.match(/(\w+)\s*=\s*\?/i));
          if (otherConditions.length > 0) {
            results = results.filter((row: any) => {
              return otherConditions.every((condition) => {
                // Handle: column = 0 (for boolean false)
                const eqZeroMatch = condition.match(/(\w+)\s*=\s*0/i);
                if (eqZeroMatch) {
                  const column = eqZeroMatch[1];
                  return row[column] === false || row[column] === 0;
                }

                // Handle: column > datetime("now")
                const gtNowMatch = condition.match(/(\w+)\s*>\s*datetime\("now"\)/i);
                if (gtNowMatch) {
                  const column = gtNowMatch[1];
                  const now = new Date().toISOString();
                  return row[column] > now;
                }

                // Handle: column > datetime('now')
                const gtNowMatch2 = condition.match(/(\w+)\s*>\s*datetime\('now'\)/i);
                if (gtNowMatch2) {
                  const column = gtNowMatch2[1];
                  const now = new Date().toISOString();
                  return row[column] > now;
                }

                // Default: return true if condition doesn't match known patterns
                return true;
              });
            });
          }
        }
      }

      // ORDER BY
      if (sql.includes('ORDER BY')) {
        const orderMatch = sql.match(/ORDER BY\s+(\w+)\s+(ASC|DESC)/i);
        if (orderMatch) {
          const column = orderMatch[1];
          const direction = orderMatch[2].toUpperCase();
          results.sort((a: any, b: any) => {
            const aVal = a[column];
            const bVal = b[column];
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return direction === 'DESC' ? -comparison : comparison;
          });
        }
      }

      if (mode === 'get') {
        return results[0] || null;
      }
      return results;
    }

    // INSERT queries
    if (upperSql.startsWith('INSERT')) {
      const insertMatch = sql.match(
        /INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i
      );
      if (insertMatch) {
        const table = insertMatch[1];
        const columns = insertMatch[2].split(',').map((c) => c.trim());
        const values = insertMatch[3].split(',').map((v) => v.trim());

        if (table === 'users') {
          const user: User = {
            id: database.nextId++,
            email: '',
            password_hash: undefined,
            name: null,
            google_id: null,
            role: 'community',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            email_verified: false,
            email_verified_at: null,
          };

          columns.forEach((col, index) => {
            const value =
              params[index] !== undefined
                ? params[index]
                : values[index] === '?'
                ? null
                : values[index];
            if (col === 'email') {
              // Normalize email to lowercase
              user.email = value ? String(value).toLowerCase() : '';
            } else if (col === 'password_hash') user.password_hash = value;
            else if (col === 'name') user.name = value;
            else if (col === 'google_id') user.google_id = value;
            else if (col === 'role') user.role = value;
            else if (col === 'email_verified') user.email_verified = value === true || value === 1;
            else if (col === 'email_verified_at') user.email_verified_at = value;
          });
          // Google OAuth users are considered email-verified
          if (user.google_id) {
            user.email_verified = true;
            user.email_verified_at = user.created_at;
          }

          // Check for duplicate email (case-insensitive) before inserting
          if (user.email) {
            const existingUser = database.users.find(
              (u) => u.email.toLowerCase() === user.email.toLowerCase()
            );
            if (existingUser) {
              throw new Error(`User with email ${user.email} already exists`);
            }
          }

          // Check for duplicate google_id before inserting
          if (user.google_id) {
            const existingUser = database.users.find(
              (u) => u.google_id === user.google_id
            );
            if (existingUser) {
              throw new Error(`User with Google ID ${user.google_id} already exists`);
            }
          }

          database.users.push(user);
          saveDatabase(database);
          // Force reload to ensure consistency - use setTimeout to ensure file is written
          // But actually, we should reload immediately since saveDatabase is synchronous
          database = loadDatabase();

          return {
            lastInsertRowid: user.id,
            changes: 1,
          };
        } else if (table === 'admin_invitations') {
          if (!database.admin_invitations) {
            database.admin_invitations = [];
          }
          if (!database.nextInvitationId) {
            database.nextInvitationId = 1;
          }

          const invitation: AdminInvitation = {
            id: database.nextInvitationId++,
            email: '',
            token: '',
            created_at: new Date().toISOString(),
            expires_at: '',
            used: false,
          };

          columns.forEach((col, index) => {
            const value =
              params[index] !== undefined
                ? params[index]
                : values[index] === '?'
                ? null
                : values[index];
            if (col === 'email') invitation.email = value;
            else if (col === 'token') invitation.token = value;
            else if (col === 'expires_at') invitation.expires_at = value;
            else if (col === 'used') invitation.used = value === true || value === 1;
          });

          database.admin_invitations.push(invitation);
          saveDatabase(database);

          return {
            lastInsertRowid: invitation.id,
          };
        } else if (table === 'email_verifications') {
          if (!database.email_verifications) {
            database.email_verifications = [];
          }
          if (!database.nextVerificationId) {
            database.nextVerificationId = 1;
          }
          const ev: EmailVerification = {
            id: database.nextVerificationId++,
            user_id: 0,
            token: '',
            expires_at: '',
          };
          columns.forEach((col, index) => {
            const value =
              params[index] !== undefined
                ? params[index]
                : values[index] === '?'
                ? null
                : values[index];
            if (col === 'user_id') ev.user_id = Number(value);
            else if (col === 'token') ev.token = String(value ?? '');
            else if (col === 'expires_at') ev.expires_at = String(value ?? '');
          });
          database.email_verifications.push(ev);
          saveDatabase(database);
          return { lastInsertRowid: ev.id, changes: 1 };
        }
      }
    }

    // UPDATE queries
    if (upperSql.startsWith('UPDATE')) {
      // Match UPDATE with optional WHERE clause
      const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
      if (updateMatch) {
        const table = updateMatch[1];
        const setClause = updateMatch[2].trim();
        const whereClause = updateMatch[3]?.trim();

        if (table === 'users') {
          // Parse SET clause to get columns and parameter positions
          const setParts = setClause.split(',').map((p) => p.trim());
          const setColumns: { col: string; paramIndex: number }[] = [];
          let paramIndex = 0;

          setParts.forEach((part) => {
            const setMatch = part.match(/(\w+)\s*=\s*(.+)/);
            if (setMatch) {
              const col = setMatch[1];
              const valueExpr = setMatch[2].trim();
              if (valueExpr === '?') {
                setColumns.push({ col, paramIndex });
                paramIndex++;
              } else if (valueExpr === 'CURRENT_TIMESTAMP' && col === 'updated_at') {
                // Handle CURRENT_TIMESTAMP
                setColumns.push({ col: 'updated_at', paramIndex: -1 });
              }
            }
          });

          // Find WHERE parameter index (comes after SET parameters)
          const whereParamIndex = paramIndex;

          let updated = 0;
          database.users.forEach((user) => {
            let matches = true;

            // Check WHERE clause
            if (whereClause) {
              const whereMatch = whereClause.match(/(\w+)\s*=\s*\?/);
              if (whereMatch) {
                const column = whereMatch[1];
                const value = params[whereParamIndex];
                matches = (user as any)[column] === value;
              }
            }

            if (matches) {
              // Apply SET clause updates
              setColumns.forEach(({ col, paramIndex: idx }) => {
                if (col === 'role' && idx >= 0) {
                  user.role = params[idx] as 'community' | 'admin';
                } else if (col === 'password_hash' && idx >= 0) {
                  user.password_hash = params[idx];
                } else if (col === 'name' && idx >= 0) {
                  user.name = params[idx];
                } else if (col === 'google_id' && idx >= 0) {
                  user.google_id = params[idx];
                } else if (col === 'email_verified' && idx >= 0) {
                  (user as any).email_verified = params[idx] === true || params[idx] === 1;
                } else if (col === 'email_verified_at' && idx >= 0) {
                  (user as any).email_verified_at = params[idx];
                } else if (col === 'updated_at') {
                  if (idx === -1) {
                    // CURRENT_TIMESTAMP
                    user.updated_at = new Date().toISOString();
                  } else {
                    user.updated_at = params[idx];
                  }
                }
              });
              updated++;
            }
          });

          if (updated > 0) {
            saveDatabase(database);
            // Reload database to ensure consistency
            database = loadDatabase();
          }
        } else if (table === 'admin_invitations') {
          if (!database.admin_invitations) {
            database.admin_invitations = [];
          }

          const setParts = setClause.split(',').map((p) => p.trim());
          const setColumns: { col: string; paramIndex: number }[] = [];
          let paramIndex = 0;

          setParts.forEach((part) => {
            const setMatch = part.match(/(\w+)\s*=\s*(.+)/);
            if (setMatch) {
              const col = setMatch[1];
              const valueExpr = setMatch[2].trim();
              if (valueExpr === '?') {
                setColumns.push({ col, paramIndex });
                paramIndex++;
              }
            }
          });

          const whereParamIndex = paramIndex;
          let updated = 0;

          database.admin_invitations.forEach((invitation) => {
            let matches = true;

            if (whereClause) {
              const whereMatch = whereClause.match(/(\w+)\s*=\s*\?/);
              if (whereMatch) {
                const column = whereMatch[1];
                const value = params[whereParamIndex];
                matches = (invitation as any)[column] === value;
              }
            }

            if (matches) {
              setColumns.forEach(({ col, paramIndex: idx }) => {
                if (col === 'used' && idx >= 0) {
                  invitation.used = params[idx] === true || params[idx] === 1;
                }
              });
              updated++;
            }
          });

          if (updated > 0) {
            saveDatabase(database);
            database = loadDatabase();
          }
        }
      }
    }

    // DELETE queries
    if (upperSql.startsWith('DELETE')) {
      const deleteMatch = sql.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (deleteMatch) {
        const table = deleteMatch[1];
        const whereCol = deleteMatch[2];
        const paramValue = params[0];
        if (table === 'email_verifications' && database.email_verifications) {
          const before = database.email_verifications.length;
          database.email_verifications = database.email_verifications.filter(
            (row: any) => row[whereCol] !== paramValue
          );
          if (database.email_verifications.length !== before) {
            saveDatabase(database);
            database = loadDatabase();
          }
          return { changes: before - database.email_verifications.length };
        }
      }
    }

    // CREATE TABLE - just ensure structure exists
    if (upperSql.startsWith('CREATE')) {
      // Tables are created implicitly, just ensure structure
      return;
    }

    // CREATE INDEX - no-op for JSON
    if (upperSql.startsWith('CREATE INDEX')) {
      return;
    }

    return { lastInsertRowid: database.nextId - 1 };
  }

  exec(sql: string) {
    // For CREATE TABLE and CREATE INDEX, just ensure structure
    const upperSql = sql.trim().toUpperCase();
    if (upperSql.startsWith('CREATE TABLE') || upperSql.startsWith('CREATE INDEX')) {
      // Structure is implicit in JSON
      return;
    }
  }

  pragma(setting: string) {
    // No-op for JSON database
    return;
  }
}

// Initialize database structure
const db = new DatabaseWrapper();

// Create users table structure (implicit in JSON)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    google_id TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'community' CHECK(role IN ('community', 'admin')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create indexes (no-op for JSON)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
`);

// Create admin_invitations table structure (implicit in JSON)
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used BOOLEAN DEFAULT 0
  )
`);

export default db;
