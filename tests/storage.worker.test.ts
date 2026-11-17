import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { StorageClient, type WorkerPort } from '../electron/storage/client';
import { createStorageHandler, parseStorageRequest } from '../electron/storage/handler';
import { MIGRATION_ERRORS } from '../electron/storage/migrations';
import {
  STORAGE_ERRORS,
  type StorageOp,
  type WorkerRequest,
} from '../electron/storage/protocol';
import { LATEST_SCHEMA_VERSION } from '../electron/storage/schema';

/**
 * Phase 3b: the worker's request handler and main's client. The real worker
 * file only wraps the handler; it is checked in the built app.
 */

/** A handler on one in-memory database, plus a way to read that database. */
function memoryHandler() {
  const db = new DatabaseSync(':memory:');
  // Every `open` gets this same connection, so the test can inspect it.
  const handle = createStorageHandler(() => db);
  return { db, handle };
}

const thread = (
  overrides: Partial<{ title: string; updatedAt: number; sectionId: string | null; position: number }> = {},
): StorageOp => ({
  kind: 'saveThread',
  thread: { id: 't1', title: 'Hello', createdAt: 1, updatedAt: 1, sectionId: null, position: 0, ...overrides },
});

const message = (id: string, position: number, threadId = 't1'): StorageOp => ({
  kind: 'saveMessage',
  message: { id, threadId, position, role: 'user', content: `text ${id}`, createdAt: 2 },
});

describe('parseStorageRequest', () => {
  it('accepts well-formed requests', () => {
    expect(parseStorageRequest({ type: 'open', filePath: 'a.db' })).toEqual({
      type: 'open',
      filePath: 'a.db',
    });
    expect(parseStorageRequest({ type: 'write', ops: [thread(), message('m1', 0)] })).toEqual({
      type: 'write',
      ops: [thread(), message('m1', 0)],
    });
    expect(parseStorageRequest({ type: 'close' })).toEqual({ type: 'close' });
  });

  it.each([
    null,
    'open',
    { type: 'drop' },
    { type: 'open' },
    { type: 'open', filePath: '' },
    { type: 'write' },
    { type: 'write', ops: [{ kind: 'deleteThread', id: 't1' }] },
    { type: 'write', ops: [{ kind: 'saveThread', thread: { id: '', title: 'x', createdAt: 1, updatedAt: 1 } }] },
    { type: 'write', ops: [{ kind: 'saveThread', thread: { id: 't', title: 'x', createdAt: -1, updatedAt: 1 } }] },
    {
      type: 'write',
      ops: [
        {
          kind: 'saveMessage',
          message: { id: 'm', threadId: 't', position: 0, role: 'robot', content: '', createdAt: 1 },
        },
      ],
    },
    { type: 'write', ops: [{ kind: 'saveSection', section: { id: 's', title: 'x', kind: 'other', position: 0, isCollapsed: false } }] },
    { type: 'write', ops: [{ kind: 'saveSection', section: { id: 's', title: 'x', kind: 'custom', position: 0, isCollapsed: 'no' } }] },
    { type: 'write', ops: [{ kind: 'deleteSection', id: '' }] },
    { type: 'write', ops: [{ kind: 'saveSetting', key: 'apiKey', value: 'x' }] },
    { type: 'write', ops: [{ kind: 'saveSetting', key: 'activeThreadId', value: 7 }] },
    { type: 'write', ops: [{ kind: 'saveThread', thread: { id: 't', title: 'x', createdAt: 1, updatedAt: 1, sectionId: 5, position: 0 } }] },
  ])('rejects %j', (value) => {
    expect(parseStorageRequest(value)).toBeNull();
  });
});

describe('createStorageHandler', () => {
  it('opens and migrates the database', () => {
    const { handle } = memoryHandler();
    expect(handle({ type: 'open', filePath: ':memory:' })).toEqual({
      ok: true,
      value: LATEST_SCHEMA_VERSION,
    });
    expect(handle({ type: 'open', filePath: ':memory:' })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.alreadyOpen,
    });
  });

  it('refuses writes before the database is open, and malformed requests', () => {
    const { handle } = memoryHandler();
    expect(handle({ type: 'write', ops: [thread()] })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.notOpen,
    });
    expect(handle({ type: 'nonsense' })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.invalidRequest,
    });
  });

  it('saves threads and messages, updating a thread in place', () => {
    const { db, handle } = memoryHandler();
    handle({ type: 'open', filePath: ':memory:' });

    expect(handle({ type: 'write', ops: [thread(), message('m1', 0)] })).toEqual({
      ok: true,
      value: null,
    });
    handle({ type: 'write', ops: [thread({ title: 'Renamed', updatedAt: 5 }), message('m1', 0)] });

    expect(db.prepare('SELECT id, title, created_at, updated_at FROM threads').all()).toEqual([
      { id: 't1', title: 'Renamed', created_at: 1, updated_at: 5 },
    ]);
    expect(db.prepare('SELECT id, position, content FROM messages').all()).toEqual([
      { id: 'm1', position: 0, content: 'text m1' },
    ]);
  });

  it('saves where a thread sits, and updates it when it moves', () => {
    const { db, handle } = memoryHandler();
    handle({ type: 'open', filePath: ':memory:' });

    handle({ type: 'write', ops: [thread()] });
    handle({ type: 'write', ops: [thread({ sectionId: 'pinned', position: 2 })] });

    expect(db.prepare('SELECT section_id, position FROM threads').all()).toEqual([
      { section_id: 'pinned', position: 2 },
    ]);
  });

  it('saves, updates and deletes sections', () => {
    const { db, handle } = memoryHandler();
    handle({ type: 'open', filePath: ':memory:' });
    const section = (title: string, isCollapsed: boolean): StorageOp => ({
      kind: 'saveSection',
      section: { id: 's1', title, kind: 'custom', position: 1, isCollapsed },
    });

    handle({ type: 'write', ops: [section('Work', false)] });
    handle({ type: 'write', ops: [section('Work', true)] });
    expect(db.prepare('SELECT id, title, kind, position, is_collapsed FROM sections').all()).toEqual([
      { id: 's1', title: 'Work', kind: 'custom', position: 1, is_collapsed: 1 },
    ]);

    handle({ type: 'write', ops: [{ kind: 'deleteSection', id: 's1' }] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sections').get()).toEqual({ n: 0 });
  });

  it('saves a setting, and clears it when set to null', () => {
    const { db, handle } = memoryHandler();
    handle({ type: 'open', filePath: ':memory:' });

    handle({ type: 'write', ops: [{ kind: 'saveSetting', key: 'activeThreadId', value: 't1' }] });
    handle({ type: 'write', ops: [{ kind: 'saveSetting', key: 'activeThreadId', value: 't2' }] });
    expect(db.prepare('SELECT key, value FROM settings').all()).toEqual([
      { key: 'activeThreadId', value: 't2' },
    ]);

    handle({ type: 'write', ops: [{ kind: 'saveSetting', key: 'activeThreadId', value: null }] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
  });

  it('applies a write all-or-nothing', () => {
    const { db, handle } = memoryHandler();
    handle({ type: 'open', filePath: ':memory:' });

    // The second message names a thread that does not exist (foreign key).
    expect(
      handle({ type: 'write', ops: [thread(), message('m1', 0), message('m2', 0, 'missing')] }),
    ).toEqual({ ok: false, error: STORAGE_ERRORS.writeFailed });

    expect(db.prepare('SELECT COUNT(*) AS n FROM threads').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });

  it('reports a fixed message when the file cannot be opened', () => {
    const handle = createStorageHandler(() => {
      throw new Error('SQLITE_CANTOPEN: /home/someone/secret/path.db');
    });
    expect(handle({ type: 'open', filePath: 'x.db' })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.openFailed,
    });
  });

  it('refuses a database from a newer version and does not keep it open', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${String(LATEST_SCHEMA_VERSION + 1)}`);
    const handle = createStorageHandler(() => db);

    expect(handle({ type: 'open', filePath: 'x.db' })).toEqual({
      ok: false,
      error: MIGRATION_ERRORS.newerDatabase,
    });
    expect(db.isOpen).toBe(false);
    expect(handle({ type: 'write', ops: [thread()] })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.notOpen,
    });
  });
});

/** A stand-in for a `Worker` that runs the real handler on the next tick. */
class FakeWorker extends EventEmitter implements WorkerPort {
  readonly sent: WorkerRequest[] = [];
  terminated = false;
  answer = true;
  private readonly handle = memoryHandler().handle;

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
    if (!this.answer) return;
    setImmediate(() => {
      this.emit('message', { id: message.id, result: this.handle(message.request) });
    });
  }

  terminate(): Promise<number> {
    this.terminated = true;
    this.emit('exit', 1);
    return Promise.resolve(1);
  }
}

describe('StorageClient', () => {
  it('matches each answer to its request', async () => {
    const worker = new FakeWorker();
    const client = new StorageClient(worker);

    const [opened, written] = await Promise.all([
      client.request({ type: 'open', filePath: ':memory:' }),
      client.request({ type: 'write', ops: [thread(), message('m1', 0)] }),
    ]);

    expect(opened).toEqual({ ok: true, value: LATEST_SCHEMA_VERSION });
    expect(written).toEqual({ ok: true, value: null });
    expect(worker.sent.map((sent) => sent.id)).toEqual([1, 2]);
  });

  it('ignores answers that are malformed or for unknown requests', async () => {
    const worker = new FakeWorker();
    const client = new StorageClient(worker);
    worker.emit('message', 'garbage');
    worker.emit('message', { id: 99, result: { ok: true, value: null } });

    await expect(client.request({ type: 'open', filePath: ':memory:' })).resolves.toEqual({
      ok: true,
      value: LATEST_SCHEMA_VERSION,
    });
  });

  it('settles waiting requests with an error when the worker crashes', async () => {
    const worker = new FakeWorker();
    worker.answer = false;
    const client = new StorageClient(worker);

    const waiting = client.request({ type: 'open', filePath: ':memory:' });
    worker.emit('error', new Error('boom'));

    await expect(waiting).resolves.toEqual({ ok: false, error: STORAGE_ERRORS.workerStopped });
    expect(client.isRunning).toBe(false);
    await expect(client.request({ type: 'close' })).resolves.toEqual({
      ok: false,
      error: STORAGE_ERRORS.workerStopped,
    });
  });

  it('settles waiting requests when the worker exits', async () => {
    const worker = new FakeWorker();
    worker.answer = false;
    const client = new StorageClient(worker);

    const waiting = client.request({ type: 'write', ops: [] });
    worker.emit('exit', 1);

    await expect(waiting).resolves.toEqual({ ok: false, error: STORAGE_ERRORS.workerStopped });
  });

  it('closes the database, then ends the worker', async () => {
    const worker = new FakeWorker();
    const client = new StorageClient(worker);
    await client.request({ type: 'open', filePath: ':memory:' });

    await client.close();

    expect(worker.sent.at(-1)?.request).toEqual({ type: 'close' });
    expect(worker.terminated).toBe(true);
    expect(client.isRunning).toBe(false);
  });
});
