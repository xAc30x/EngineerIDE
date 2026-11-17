/**
 * The database schema, as an ordered list of migrations (Phase 3b).
 *
 * Migration `n` upgrades a database from version `n - 1` to `n`. The version
 * a database is at is kept in SQLite's built-in `user_version`. Never edit a
 * migration that has shipped: add a new one at the end instead, so every
 * existing database is upgraded the same way.
 */

export interface Migration {
  /** 1 for the first migration, then 2, 3, … with no gaps. */
  version: number;
  /** What the migration does, for error messages and reviews. */
  description: string;
  /** One or more SQL statements, run inside a transaction. */
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Threads and their messages',
    sql: `
      CREATE TABLE threads (
        id         TEXT    PRIMARY KEY,
        title      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE messages (
        id         TEXT    PRIMARY KEY,
        thread_id  TEXT    NOT NULL REFERENCES threads (id),
        position   INTEGER NOT NULL,
        role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content    TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (thread_id, position)
      ) STRICT;
    `,
  },
];

/** The version a database has once every migration has run. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;
