import type { DatabaseSync } from 'node:sqlite';
import type { IpcResult } from '../../shared/types';
import { MIGRATION_ERRORS, MigrationError, runMigrations } from './migrations';
import {
  STORAGE_ERRORS,
  type StorageOp,
  type StorageRequest,
  type StoredMessage,
  type StoredThread,
} from './protocol';

/**
 * What the storage worker does with each request (Phase 3b). It owns the one
 * database connection. No Electron or worker imports, so tests drive it
 * directly with an in-memory database.
 */

export type OpenDatabase = (filePath: string) => DatabaseSync;
export type StorageHandler = (request: unknown) => IpcResult<unknown>;

const ROLES = new Set(['user', 'assistant', 'system']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseThread(value: unknown): StoredThread | null {
  if (!isRecord(value)) return null;
  const { id, title, createdAt, updatedAt } = value;
  if (!isId(id) || !isText(title) || !isTime(createdAt) || !isTime(updatedAt)) return null;
  return { id, title, createdAt, updatedAt };
}

function parseMessage(value: unknown): StoredMessage | null {
  if (!isRecord(value)) return null;
  const { id, threadId, position, role, content, createdAt } = value;
  if (
    !isId(id) ||
    !isId(threadId) ||
    !isTime(position) ||
    !isText(role) ||
    !ROLES.has(role) ||
    !isText(content) ||
    !isTime(createdAt)
  ) {
    return null;
  }
  return { id, threadId, position, role: role as StoredMessage['role'], content, createdAt };
}

function parseOp(value: unknown): StorageOp | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'saveThread') {
    const thread = parseThread(value.thread);
    return thread && { kind: 'saveThread', thread };
  }
  if (value.kind === 'saveMessage') {
    const message = parseMessage(value.message);
    return message && { kind: 'saveMessage', message };
  }
  return null;
}

/** Validates a request. Returns `null` for anything malformed. */
export function parseStorageRequest(value: unknown): StorageRequest | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'open':
      return isText(value.filePath) && value.filePath !== ''
        ? { type: 'open', filePath: value.filePath }
        : null;
    case 'write': {
      if (!Array.isArray(value.ops)) return null;
      const ops: StorageOp[] = [];
      for (const raw of value.ops) {
        const op = parseOp(raw);
        if (op === null) return null;
        ops.push(op);
      }
      return { type: 'write', ops };
    }
    case 'close':
      return { type: 'close' };
    default:
      return null;
  }
}

// A thread keeps its first created_at; title and updated_at follow memory.
const SAVE_THREAD_SQL = `
  INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`;

// Messages never change once written, so a repeat is ignored.
const SAVE_MESSAGE_SQL = `
  INSERT INTO messages (id, thread_id, position, role, content, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO NOTHING`;

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function fail(error: string): IpcResult<never> {
  return { ok: false, error };
}

export function createStorageHandler(openDatabase: OpenDatabase): StorageHandler {
  let db: DatabaseSync | null = null;

  function open(filePath: string): IpcResult<number> {
    if (db !== null) return fail(STORAGE_ERRORS.alreadyOpen);
    let opened: DatabaseSync | null = null;
    try {
      opened = openDatabase(filePath);
      opened.exec('PRAGMA foreign_keys = ON');
      opened.exec('PRAGMA journal_mode = WAL');
      const version = runMigrations(opened);
      db = opened;
      return ok(version);
    } catch (error) {
      opened?.close();
      // Migration errors are fixed messages already; anything else is replaced.
      const isNewer =
        error instanceof MigrationError && error.message === MIGRATION_ERRORS.newerDatabase;
      return fail(isNewer ? MIGRATION_ERRORS.newerDatabase : STORAGE_ERRORS.openFailed);
    }
  }

  function write(database: DatabaseSync, ops: StorageOp[]): IpcResult<null> {
    const saveThread = database.prepare(SAVE_THREAD_SQL);
    const saveMessage = database.prepare(SAVE_MESSAGE_SQL);
    database.exec('BEGIN');
    try {
      for (const op of ops) {
        if (op.kind === 'saveThread') {
          const { id, title, createdAt, updatedAt } = op.thread;
          saveThread.run(id, title, createdAt, updatedAt);
        } else {
          const { id, threadId, position, role, content, createdAt } = op.message;
          saveMessage.run(id, threadId, position, role, content, createdAt);
        }
      }
      database.exec('COMMIT');
      return ok(null);
    } catch {
      database.exec('ROLLBACK');
      return fail(STORAGE_ERRORS.writeFailed);
    }
  }

  return (raw) => {
    const request = parseStorageRequest(raw);
    if (request === null) return fail(STORAGE_ERRORS.invalidRequest);
    switch (request.type) {
      case 'open':
        return open(request.filePath);
      case 'write':
        return db === null ? fail(STORAGE_ERRORS.notOpen) : write(db, request.ops);
      case 'close':
        db?.close();
        db = null;
        return ok(null);
    }
  };
}
