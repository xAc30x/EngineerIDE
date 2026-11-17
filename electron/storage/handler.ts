import type { DatabaseSync } from 'node:sqlite';
import type { IpcResult } from '../../shared/types';
import { MIGRATION_ERRORS, MigrationError, runMigrations } from './migrations';
import {
  SETTING_KEYS,
  STORAGE_ERRORS,
  type SettingKey,
  type StorageOp,
  type StorageRequest,
  type LoadedThread,
  type StoredData,
  type StoredMessage,
  type StoredSection,
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
const SECTION_KINDS = new Set(['pinned', 'custom']);
const SETTINGS = new Set<string>(SETTING_KEYS);
const MAX_SETTING_LENGTH = 4096;

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
  const { id, title, createdAt, updatedAt, sectionId, position } = value;
  if (
    !isId(id) ||
    !isText(title) ||
    !isTime(createdAt) ||
    !isTime(updatedAt) ||
    !(sectionId === null || isId(sectionId)) ||
    !isTime(position)
  ) {
    return null;
  }
  return { id, title, createdAt, updatedAt, sectionId, position };
}

function parseSection(value: unknown): StoredSection | null {
  if (!isRecord(value)) return null;
  const { id, title, kind, position, isCollapsed } = value;
  if (
    !isId(id) ||
    !isText(title) ||
    !isText(kind) ||
    !SECTION_KINDS.has(kind) ||
    !isTime(position) ||
    typeof isCollapsed !== 'boolean'
  ) {
    return null;
  }
  return { id, title, kind: kind as StoredSection['kind'], position, isCollapsed };
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
  if (value.kind === 'saveSection') {
    const section = parseSection(value.section);
    return section && { kind: 'saveSection', section };
  }
  if (value.kind === 'deleteSection') {
    return isId(value.id) ? { kind: 'deleteSection', id: value.id } : null;
  }
  if (value.kind === 'saveSetting') {
    const { key, value: setting } = value;
    const validValue =
      setting === null || (isText(setting) && setting.length <= MAX_SETTING_LENGTH);
    return isText(key) && SETTINGS.has(key) && validValue
      ? { kind: 'saveSetting', key: key as SettingKey, value: setting }
      : null;
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
    case 'load':
      return { type: 'load' };
    case 'loadMessages':
      return isId(value.threadId) ? { type: 'loadMessages', threadId: value.threadId } : null;
    case 'close':
      return { type: 'close' };
    default:
      return null;
  }
}

// A thread keeps its first created_at; everything else follows memory.
const SAVE_THREAD_SQL = `
  INSERT INTO threads (id, title, created_at, updated_at, section_id, position)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    title = excluded.title,
    updated_at = excluded.updated_at,
    section_id = excluded.section_id,
    position = excluded.position`;

const SAVE_SECTION_SQL = `
  INSERT INTO sections (id, title, kind, position, is_collapsed) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    title = excluded.title,
    position = excluded.position,
    is_collapsed = excluded.is_collapsed`;

const DELETE_SECTION_SQL = 'DELETE FROM sections WHERE id = ?';

const SAVE_SETTING_SQL = `
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value`;

const DELETE_SETTING_SQL = 'DELETE FROM settings WHERE key = ?';

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

function applyOp(database: DatabaseSync, op: StorageOp): void {
  switch (op.kind) {
    case 'saveThread': {
      const { id, title, createdAt, updatedAt, sectionId, position } = op.thread;
      database.prepare(SAVE_THREAD_SQL).run(id, title, createdAt, updatedAt, sectionId, position);
      return;
    }
    case 'saveMessage': {
      const { id, threadId, position, role, content, createdAt } = op.message;
      database.prepare(SAVE_MESSAGE_SQL).run(id, threadId, position, role, content, createdAt);
      return;
    }
    case 'saveSection': {
      const { id, title, kind, position, isCollapsed } = op.section;
      database.prepare(SAVE_SECTION_SQL).run(id, title, kind, position, isCollapsed ? 1 : 0);
      return;
    }
    case 'deleteSection':
      database.prepare(DELETE_SECTION_SQL).run(op.id);
      return;
    case 'saveSetting':
      if (op.value === null) {
        database.prepare(DELETE_SETTING_SQL).run(op.key);
      } else {
        database.prepare(SAVE_SETTING_SQL).run(op.key, op.value);
      }
      return;
  }
}

const LOAD_SECTIONS_SQL = `
  SELECT id, title, kind, position, is_collapsed AS isCollapsed
  FROM sections ORDER BY position, id`;

const LOAD_THREADS_SQL = `
  SELECT t.id, t.title, t.created_at AS createdAt, t.updated_at AS updatedAt,
         t.section_id AS sectionId, t.position,
         (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS messageCount
  FROM threads t ORDER BY t.section_id, t.position, t.updated_at DESC, t.id`;

const LOAD_MESSAGES_SQL = `
  SELECT id, thread_id AS threadId, position, role, content, created_at AS createdAt
  FROM messages WHERE thread_id = ? ORDER BY position`;

const LOAD_SETTINGS_SQL = 'SELECT key, value FROM settings';

/**
 * Reads everything back. Each row goes through the same checks as a write,
 * so a damaged row is skipped instead of reaching the app.
 */
function load(database: DatabaseSync): StoredData {
  const sections = database
    .prepare(LOAD_SECTIONS_SQL)
    .all()
    .map((row) => parseSection({ ...row, isCollapsed: row.isCollapsed === 1 }))
    .filter((section): section is StoredSection => section !== null);
  const threads: LoadedThread[] = [];
  for (const row of database.prepare(LOAD_THREADS_SQL).all()) {
    const thread = parseThread(row);
    if (thread !== null && isTime(row.messageCount)) {
      threads.push({ ...thread, messageCount: row.messageCount });
    }
  }
  const settings: StoredData['settings'] = {};
  for (const row of database.prepare(LOAD_SETTINGS_SQL).all()) {
    const { key, value } = row;
    if (isText(key) && SETTINGS.has(key) && isText(value) && value.length <= MAX_SETTING_LENGTH) {
      settings[key as SettingKey] = value;
    }
  }
  return { sections, threads, settings };
}

/**
 * Reads one thread's messages. A damaged row fails the whole read: a thread
 * with a gap could not take new messages at the right positions.
 */
function loadMessages(database: DatabaseSync, threadId: string): IpcResult<StoredMessage[]> {
  const messages: StoredMessage[] = [];
  for (const row of database.prepare(LOAD_MESSAGES_SQL).all(threadId)) {
    const message = parseMessage(row);
    if (message === null || message.position !== messages.length) {
      return fail(STORAGE_ERRORS.loadFailed);
    }
    messages.push(message);
  }
  return ok(messages);
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
    database.exec('BEGIN');
    try {
      for (const op of ops) {
        applyOp(database, op);
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
      case 'load':
        if (db === null) return fail(STORAGE_ERRORS.notOpen);
        try {
          return ok(load(db));
        } catch {
          return fail(STORAGE_ERRORS.loadFailed);
        }
      case 'loadMessages':
        if (db === null) return fail(STORAGE_ERRORS.notOpen);
        try {
          return loadMessages(db, request.threadId);
        } catch {
          return fail(STORAGE_ERRORS.loadFailed);
        }
      case 'close':
        db?.close();
        db = null;
        return ok(null);
    }
  };
}
