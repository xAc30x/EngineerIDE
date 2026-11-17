import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './schema';

/**
 * Brings a database up to the latest schema (Phase 3b). Runs in the storage
 * worker, never in main. No Electron imports, so it can be unit-tested with
 * an in-memory database.
 */

/** Fixed error messages: SQLite's own text is never passed on. */
export const MIGRATION_ERRORS = {
  newerDatabase: 'The database was written by a newer version of EngineerIDE.',
  failed: 'The database could not be upgraded.',
} as const;

export class MigrationError extends Error {}

/** Reads SQLite's `user_version`: the last migration this database ran. */
export function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined;
  const version = row?.user_version;
  return typeof version === 'number' ? version : 0;
}

/**
 * Runs every migration the database has not run yet, in order, each in its
 * own transaction with its version bump, so a failure leaves the database at
 * the last version that fully applied. Returns the version it ends at.
 */
export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): number {
  const latest = migrations.length;
  const current = readSchemaVersion(db);

  if (current > latest) {
    // A newer build changed the layout; writing into it could corrupt it.
    // Refuse, so the app runs in memory and leaves the file untouched.
    throw new MigrationError(MIGRATION_ERRORS.newerDatabase);
  }

  for (const migration of migrations.slice(current)) {
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      // PRAGMA does not accept a bound parameter; the version is a number we own.
      db.exec(`PRAGMA user_version = ${String(migration.version)}`);
      db.exec('COMMIT');
    } catch {
      db.exec('ROLLBACK');
      throw new MigrationError(MIGRATION_ERRORS.failed);
    }
  }
  return readSchemaVersion(db);
}
