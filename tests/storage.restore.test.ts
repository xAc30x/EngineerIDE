import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../electron/appStateStore';
import { createStorageHandler, type StorageHandler } from '../electron/storage/handler';
import { STORAGE_ERRORS, type StoredData, type StoredMessage } from '../electron/storage/protocol';
import { buildRestoredState, toMessages } from '../electron/storage/restore';
import { storageOpsForChange } from '../electron/storage/writer';
import { applyAction, createInitialSharedState, type SharedState } from '../shared/appState';

/** Phase 3c: reading the database back and building the launch state. */

const EMPTY: StoredData = { sections: [], threads: [], settings: {} };

function openHandler() {
  const handle = createStorageHandler(() => new DatabaseSync(':memory:'));
  handle({ type: 'open', filePath: ':memory:' });
  return handle;
}

/** Saves `state` from scratch into a new database and reads the launch data back. */
function roundTrip(state: SharedState): { data: StoredData; handle: StorageHandler } {
  const handle = openHandler();
  const nothing: SharedState = { ...createInitialSharedState(), sections: [] };
  const ops = storageOpsForChange(nothing, state);
  expect(handle({ type: 'write', ops })).toEqual({ ok: true, value: null });
  const loaded = handle({ type: 'load' });
  if (!loaded.ok) throw new Error(loaded.error);
  return { data: loaded.value as StoredData, handle };
}

/** Restores `state` and then loads every thread's messages, as main would on demand. */
function restoreAndLoadAll(state: SharedState): SharedState {
  const { data, handle } = roundTrip(state);
  let restored = buildRestoredState(data).state;
  for (const thread of data.threads) {
    const read = handle({ type: 'loadMessages', threadId: thread.id });
    if (!read.ok) throw new Error(read.error);
    restored = applyAction(restored, {
      type: 'loadThreadMessages',
      threadId: thread.id,
      messages: toMessages(read.value as StoredMessage[]),
    });
  }
  return restored;
}

describe('buildRestoredState', () => {
  it('gives a new database the built-in sections, and saves them', () => {
    const { state, saved, projectPath } = buildRestoredState(EMPTY);

    expect(state.sections.map((section) => section.title)).toEqual(['Pinned', 'Work', 'Personal']);
    expect(saved.sections).toEqual([]);
    expect(storageOpsForChange(saved, state).map((op) => op.kind)).toEqual([
      'saveSection',
      'saveSection',
      'saveSection',
    ]);
    expect(projectPath).toBeNull();
  });

  it('keeps a database that has threads but no sections (saved by 3b)', () => {
    const { state } = buildRestoredState({
      ...EMPTY,
      threads: [
        { id: 'old', title: 'Old', createdAt: 1, updatedAt: 1, sectionId: null, position: 0, messageCount: 1 },
        { id: 'new', title: 'New', createdAt: 2, updatedAt: 5, sectionId: null, position: 0, messageCount: 0 },
      ],
    });

    // Same position: newest first, as Recents shows them.
    expect(state.recents.map((thread) => thread.id)).toEqual(['new', 'old']);
    // Messages stay in the database until needed; an empty thread has none to load.
    expect(state.recents[1]).toMatchObject({ messages: [], messageCount: 1, messagesLoaded: false });
    expect(state.recents[0]).toMatchObject({ messageCount: 0, messagesLoaded: true });
    expect(state.sections.map((section) => section.title)).toEqual(['Pinned', 'Work', 'Personal']);
  });

  it('restores threads, sections, the last thread and the backend after a round trip', () => {
    let state = createInitialSharedState();
    const work = state.sections[1]?.id ?? '';
    state = applyAction(state, { type: 'sendMessage', threadId: null, content: 'first' });
    const first = state.activeThreadId ?? '';
    state = applyAction(state, { type: 'moveThread', threadId: first, sectionId: work });
    state = applyAction(state, { type: 'sendMessage', threadId: first, content: 'again' });
    state = applyAction(state, { type: 'createThread' });
    state = applyAction(state, { type: 'sendMessage', threadId: state.activeThreadId, content: 'second' });
    state = applyAction(state, { type: 'toggleSectionCollapsed', sectionId: 'pinned' });
    state = applyAction(state, { type: 'addSection', title: 'Ideas' });
    state = applyAction(state, { type: 'setSelectedBackend', backend: 'openrouter' });

    expect(restoreAndLoadAll(state)).toEqual(state);
    // Nothing differs, so the writer writes nothing at launch, and loading a
    // thread's messages writes nothing either.
    const { saved, state: atLaunch } = buildRestoredState(roundTrip(state).data);
    expect(storageOpsForChange(saved, atLaunch)).toEqual([]);
    expect(storageOpsForChange(atLaunch, restoreAndLoadAll(state))).toEqual([]);
  });

  it('does not restore a running reply', () => {
    let state = applyAction(createInitialSharedState(), {
      type: 'sendMessage',
      threadId: null,
      content: 'hello',
    });
    const threadId = state.activeThreadId ?? '';
    state = applyAction(state, {
      type: 'startReply',
      threadId,
      streamId: 's1',
      provider: 'claude-cli',
    });

    const restored = restoreAndLoadAll(state);

    expect(restored.recents[0]?.runningReply).toBeNull();
    expect(restored.recents[0]?.messages).toHaveLength(1);
  });

  it('puts a thread whose section is gone in Recents, and adds Pinned if missing', () => {
    const { state } = buildRestoredState({
      ...EMPTY,
      sections: [{ id: 'work', title: 'Work', kind: 'custom', position: 0, isCollapsed: false }],
      threads: [
        { id: 't', title: 'T', createdAt: 1, updatedAt: 1, sectionId: 'gone', position: 3, messageCount: 0 },
      ],
    });

    expect(state.recents.map((thread) => thread.id)).toEqual(['t']);
    expect(state.sections.map((section) => section.id)).toEqual(['pinned', 'work']);
  });

  it('ignores a last thread or backend that no longer makes sense, and clears it', () => {
    const { state, saved } = buildRestoredState({
      ...EMPTY,
      settings: { activeThreadId: 'missing', selectedBackend: 'not-a-backend' },
    });

    expect(state.activeThreadId).toBeNull();
    expect(state.selectedBackend).toBe(createInitialSharedState().selectedBackend);
    expect(storageOpsForChange(saved, state)).toContainEqual({
      kind: 'saveSetting',
      key: 'activeThreadId',
      value: null,
    });
  });

  it('hands back the last project without using it', () => {
    const { state, saved, projectPath } = buildRestoredState({
      ...EMPTY,
      settings: { activeProjectPath: '/projects/demo' },
    });

    expect(projectPath).toBe('/projects/demo');
    expect(state.activeProjectPath).toBeNull();
    expect(saved.activeProjectPath).toBe('/projects/demo');
  });
});

describe('the load request', () => {
  it('refuses to load before the database is open', () => {
    const handle = createStorageHandler(() => new DatabaseSync(':memory:'));
    expect(handle({ type: 'load' })).toEqual({ ok: false, error: STORAGE_ERRORS.notOpen });
  });

  it('skips a damaged row instead of passing it on', () => {
    const db = new DatabaseSync(':memory:');
    const handle = createStorageHandler(() => db);
    handle({ type: 'open', filePath: ':memory:' });
    db.exec("INSERT INTO settings (key, value) VALUES ('apiKey', 'secret'), ('activeThreadId', 't1')");
    db.exec("INSERT INTO threads (id, title, created_at, updated_at) VALUES ('', 'bad', 1, 1)");

    const loaded = handle({ type: 'load' });

    expect(loaded).toEqual({
      ok: true,
      value: { sections: [], threads: [], settings: { activeThreadId: 't1' } },
    });
  });

  it("reads one thread's messages in order, and refuses a thread with a gap", () => {
    const db = new DatabaseSync(':memory:');
    const handle = createStorageHandler(() => db);
    handle({ type: 'open', filePath: ':memory:' });
    db.exec(`
      INSERT INTO threads (id, title, created_at, updated_at) VALUES ('a', 'A', 1, 1), ('b', 'B', 1, 1);
      INSERT INTO messages (id, thread_id, position, role, content, created_at) VALUES
        ('a1', 'a', 1, 'assistant', 'second', 2), ('a0', 'a', 0, 'user', 'first', 1),
        ('b1', 'b', 1, 'user', 'gap before me', 1);
    `);

    const read = handle({ type: 'loadMessages', threadId: 'a' });
    expect(read.ok && (read.value as StoredMessage[]).map((message) => message.content)).toEqual([
      'first',
      'second',
    ]);
    expect(handle({ type: 'load' })).toMatchObject({
      ok: true,
      value: { threads: [{ id: 'a', messageCount: 2 }, { id: 'b', messageCount: 1 }] },
    });
    expect(handle({ type: 'loadMessages', threadId: 'b' })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.loadFailed,
    });
    expect(handle({ type: 'loadMessages', threadId: '' })).toEqual({
      ok: false,
      error: STORAGE_ERRORS.invalidRequest,
    });
  });
});

describe('AppStateStore.restore', () => {
  it('replaces the state, raises the version and tells subscribers', () => {
    const store = new AppStateStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const { state } = buildRestoredState(EMPTY);

    store.restore(state);

    expect(store.getSnapshot()).toEqual({ version: 1, state });
    expect(listener).toHaveBeenCalledWith({ version: 1, state });
  });
});
