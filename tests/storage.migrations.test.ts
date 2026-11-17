import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIGRATION_ERRORS,
  MigrationError,
  readSchemaVersion,
  runMigrations,
} from '../electron/storage/migrations';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, type Migration } from '../electron/storage/schema';

/** Phase 3b: the schema and the migration runner (see docs/ROADMAP.md). */

let db: DatabaseSync | undefined;

function openEmpty(): DatabaseSync {
  db = new DatabaseSync(':memory:');
  return db;
}

function tableNames(database: DatabaseSync): string[] {
  const rows = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

afterEach(() => {
  db?.close();
  db = undefined;
});

describe('schema', () => {
  it('numbers its migrations 1, 2, 3, … with no gaps', () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(
      MIGRATIONS.map((_migration, index) => index + 1),
    );
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });
});

describe('runMigrations', () => {
  it('creates the tables on an empty database and records the version', () => {
    const database = openEmpty();
    expect(readSchemaVersion(database)).toBe(0);

    expect(runMigrations(database)).toBe(LATEST_SCHEMA_VERSION);

    expect(readSchemaVersion(database)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(database)).toEqual(['messages', 'threads']);
  });

  it('changes nothing when run a second time', () => {
    const database = openEmpty();
    runMigrations(database);
    database
      .prepare('INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('t1', 'Hello', 1, 2);

    expect(runMigrations(database)).toBe(LATEST_SCHEMA_VERSION);

    expect(database.prepare('SELECT id, title FROM threads').all()).toEqual([
      { id: 't1', title: 'Hello' },
    ]);
  });

  it('runs only the migrations a database has not run yet', () => {
    const database = openEmpty();
    const migrations: Migration[] = [
      { version: 1, description: 'a', sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
      { version: 2, description: 'b', sql: 'CREATE TABLE b (x INTEGER) STRICT;' },
    ];
    runMigrations(database, migrations.slice(0, 1));
    expect(tableNames(database)).toEqual(['a']);

    expect(runMigrations(database, migrations)).toBe(2);
    expect(tableNames(database)).toEqual(['a', 'b']);
  });

  it('rolls back a failing migration and keeps the last good version', () => {
    const database = openEmpty();
    const migrations: Migration[] = [
      { version: 1, description: 'good', sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
      {
        version: 2,
        description: 'bad',
        sql: 'CREATE TABLE b (x INTEGER) STRICT; THIS IS NOT SQL;',
      },
    ];

    expect(() => runMigrations(database, migrations)).toThrow(MigrationError);
    expect(() => runMigrations(database, migrations)).toThrow(MIGRATION_ERRORS.failed);
    expect(readSchemaVersion(database)).toBe(1);
    expect(tableNames(database)).toEqual(['a']);
  });

  it('refuses a database written by a newer version and leaves it untouched', () => {
    const database = openEmpty();
    database.exec('CREATE TABLE future (x INTEGER) STRICT');
    database.exec(`PRAGMA user_version = ${String(LATEST_SCHEMA_VERSION + 1)}`);

    expect(() => runMigrations(database)).toThrow(MIGRATION_ERRORS.newerDatabase);
    expect(readSchemaVersion(database)).toBe(LATEST_SCHEMA_VERSION + 1);
    expect(tableNames(database)).toEqual(['future']);
  });

  it('rejects a message whose role is unknown', () => {
    const database = openEmpty();
    runMigrations(database);
    database
      .prepare('INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('t1', 'Hello', 1, 2);
    const insert = database.prepare(
      'INSERT INTO messages (id, thread_id, position, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );

    insert.run('m1', 't1', 0, 'user', 'hi', 3);
    expect(() => insert.run('m2', 't1', 1, 'robot', 'hi', 4)).toThrow();
  });
});
