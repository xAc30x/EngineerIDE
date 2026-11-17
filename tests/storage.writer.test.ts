import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../electron/appStateStore';
import { STORAGE_ERRORS, type StorageOp, type StoredData } from '../electron/storage/protocol';
import {
  loadStorage,
  startPersistence,
  storageOpsForChange,
  type StorageSink,
} from '../electron/storage/writer';
import { applyAction, createInitialSharedState, type SharedState } from '../shared/appState';
import type { IpcResult } from '../shared/types';

/** Phases 3b and 3c: the one writer, which turns state changes into storage ops. */

function send(state: SharedState, content: string): SharedState {
  return applyAction(state, { type: 'sendMessage', threadId: state.activeThreadId, content });
}

/** Only the thread and message ops, which 3b's tests are about. */
function threadOps(ops: StorageOp[]): StorageOp[] {
  return ops.filter((op) => op.kind === 'saveThread' || op.kind === 'saveMessage');
}

function opsOfKind<K extends StorageOp['kind']>(
  ops: StorageOp[],
  kind: K,
): Extract<StorageOp, { kind: K }>[] {
  return ops.filter((op): op is Extract<StorageOp, { kind: K }> => op.kind === kind);
}

describe('storageOpsForChange: threads and messages', () => {
  it('does not save an empty thread', () => {
    const before = createInitialSharedState();
    const after = applyAction(before, { type: 'createThread' });
    expect(after.recents).toHaveLength(1);
    expect(threadOps(storageOpsForChange(before, after))).toEqual([]);
  });

  it('saves a new thread with its first message and its place', () => {
    const before = createInitialSharedState();
    const after = send(before, 'Plan the storage layer');
    const thread = after.recents[0];

    const ops = threadOps(storageOpsForChange(before, after));

    expect(ops).toEqual([
      {
        kind: 'saveThread',
        thread: {
          id: thread?.id,
          title: 'Plan the storage layer',
          createdAt: thread?.createdAt,
          updatedAt: thread?.updatedAt,
          sectionId: null,
          position: 0,
        },
      },
      {
        kind: 'saveMessage',
        message: {
          id: thread?.messages[0]?.id,
          threadId: thread?.id,
          position: 0,
          role: 'user',
          content: 'Plan the storage layer',
          createdAt: thread?.messages[0]?.createdAt,
        },
      },
    ]);
  });

  it('saves only the messages that are new', () => {
    const first = send(createInitialSharedState(), 'one');
    const second = send(first, 'two');

    const messages = opsOfKind(storageOpsForChange(first, second), 'saveMessage');

    expect(messages.map((op) => op.message.position)).toEqual([1]);
  });

  it('saves a finished reply as a message, but not the reply while it runs', () => {
    const sent = send(createInitialSharedState(), 'hello');
    const threadId = sent.activeThreadId ?? '';
    const running = applyAction(sent, {
      type: 'startReply',
      threadId,
      streamId: 's1',
      provider: 'claude-cli',
    });
    expect(opsOfKind(storageOpsForChange(sent, running), 'saveMessage')).toEqual([]);

    const finished = applyAction(running, {
      type: 'finishReply',
      threadId,
      streamId: 's1',
      outcome: { status: 'completed', text: 'hi there' },
    });
    const messages = opsOfKind(storageOpsForChange(running, finished), 'saveMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      message: { position: 1, role: 'assistant', content: 'hi there' },
    });
  });

  it('never deletes a thread or a message', () => {
    const sent = send(createInitialSharedState(), 'hello');
    const kinds = storageOpsForChange(sent, createInitialSharedState()).map((op) => op.kind);
    // Only sections can be deleted; the thread gone from memory produces no op.
    expect(kinds.filter((kind) => kind !== 'saveSection' && kind !== 'deleteSection' && kind !== 'saveSetting')).toEqual([]);
  });

  it('saves a thread again when it moves', () => {
    const sent = send(createInitialSharedState(), 'hello');
    const threadId = sent.activeThreadId ?? '';
    const pinned = applyAction(sent, { type: 'togglePinned', threadId });

    expect(opsOfKind(storageOpsForChange(sent, pinned), 'saveThread')).toMatchObject([
      { thread: { id: threadId, sectionId: 'pinned', position: 0 } },
    ]);
  });
});

describe('storageOpsForChange: sections and settings (Phase 3c)', () => {
  it('saves every section of a state it has not seen', () => {
    const empty: SharedState = { ...createInitialSharedState(), sections: [] };
    const state = createInitialSharedState();

    const saved = opsOfKind(storageOpsForChange(empty, state), 'saveSection');

    expect(saved.map((op) => [op.section.title, op.section.kind, op.section.position])).toEqual([
      ['Pinned', 'pinned', 0],
      ['Work', 'custom', 1],
      ['Personal', 'custom', 2],
    ]);
  });

  it('saves a section that is collapsed, and nothing else', () => {
    const before = createInitialSharedState();
    const after = applyAction(before, { type: 'toggleSectionCollapsed', sectionId: 'pinned' });

    expect(storageOpsForChange(before, after)).toEqual([
      {
        kind: 'saveSection',
        section: { id: 'pinned', title: 'Pinned', kind: 'pinned', position: 0, isCollapsed: true },
      },
    ]);
  });

  it('deletes a removed section after moving its threads to Recents', () => {
    const start = createInitialSharedState();
    const work = start.sections[1]?.id ?? '';
    const sent = send(start, 'hello');
    const threadId = sent.activeThreadId ?? '';
    const moved = applyAction(sent, { type: 'moveThread', threadId, sectionId: work });

    const ops = storageOpsForChange(moved, applyAction(moved, { type: 'removeSection', sectionId: work }));

    expect(ops.at(-1)).toEqual({ kind: 'deleteSection', id: work });
    expect(opsOfKind(ops, 'saveThread')).toMatchObject([
      { thread: { id: threadId, sectionId: null } },
    ]);
  });

  it('saves the settings that changed, and clears one set to null', () => {
    const before = createInitialSharedState();
    const sent = send(before, 'hello');
    expect(opsOfKind(storageOpsForChange(before, sent), 'saveSetting')).toEqual([
      { kind: 'saveSetting', key: 'activeThreadId', value: sent.activeThreadId },
    ]);

    const withProject = applyAction(sent, {
      type: 'setActiveProject',
      folder: { path: '/projects/demo', name: 'demo' },
    });
    const cleared = applyAction(withProject, { type: 'setActiveProject', folder: null });
    expect(opsOfKind(storageOpsForChange(withProject, cleared), 'saveSetting')).toEqual([
      { kind: 'saveSetting', key: 'activeProjectPath', value: null },
    ]);
  });
});

const EMPTY_DATA: StoredData = { sections: [], threads: [], settings: {} };

/** Records requests and answers them with `ok` unless told otherwise. */
function fakeSink(
  answers: {
    open?: IpcResult<number>;
    load?: IpcResult<StoredData>;
    write?: IpcResult<null>;
    /** Never answer at all, like a stuck worker. */
    hang?: boolean;
  } = {},
) {
  const requests: { type: string }[] = [];
  const close = vi.fn(() => Promise.resolve());
  const sink: StorageSink = {
    request: ((request: { type: string }) => {
      requests.push(request);
      if (answers.hang === true) return new Promise(() => undefined);
      const result =
        request.type === 'open'
          ? (answers.open ?? { ok: true, value: 2 })
          : request.type === 'load'
            ? (answers.load ?? { ok: true, value: EMPTY_DATA })
            : (answers.write ?? { ok: true, value: null });
      return Promise.resolve(result);
    }) as StorageSink['request'],
    close,
  };
  return { sink, requests, close };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('loadStorage (Phase 3c)', () => {
  it('opens the file, then reads everything', async () => {
    const { sink, requests } = fakeSink();
    await expect(loadStorage(sink, 'app.db', 1000)).resolves.toEqual({
      ok: true,
      value: EMPTY_DATA,
    });
    expect(requests).toEqual([{ type: 'open', filePath: 'app.db' }, { type: 'load' }]);
  });

  it('reports a file that cannot be opened, and reads nothing', async () => {
    const { sink, requests } = fakeSink({ open: { ok: false, error: STORAGE_ERRORS.openFailed } });
    await expect(loadStorage(sink, 'app.db', 1000)).resolves.toEqual({
      ok: false,
      error: STORAGE_ERRORS.openFailed,
    });
    expect(requests).toHaveLength(1);
  });

  it('gives up on a worker that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { sink } = fakeSink({ hang: true });
      const result = loadStorage(sink, 'app.db', 2000);
      await vi.advanceTimersByTimeAsync(2000);
      await expect(result).resolves.toEqual({ ok: false, error: STORAGE_ERRORS.loadTimedOut });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startPersistence', () => {
  it('writes each change in order', async () => {
    const store = new AppStateStore();
    const { sink, requests } = fakeSink();
    startPersistence(store, sink, store.getSnapshot().state, () => undefined);

    store.dispatch({ type: 'sendMessage', threadId: null, content: 'one' });
    store.dispatch({ type: 'toggleSectionCollapsed', sectionId: 'pinned' });
    store.dispatch({
      type: 'sendMessage',
      threadId: store.getSnapshot().state.activeThreadId,
      content: 'two',
    });
    await flush();

    // Since 3c the collapse is saved too, so each of the three changes writes.
    expect(requests.map((request) => request.type)).toEqual(['write', 'write', 'write']);
  });

  it('first writes what differs from the saved state (Phase 3c)', async () => {
    const store = new AppStateStore();
    const saved: SharedState = { ...store.getSnapshot().state, sections: [] };
    const { sink, requests } = fakeSink();

    startPersistence(store, sink, saved, () => undefined);
    await flush();

    expect(requests).toHaveLength(1);
    const ops = (requests[0] as unknown as { ops: StorageOp[] }).ops;
    expect(opsOfKind(ops, 'saveSection').map((op) => op.section.title)).toEqual([
      'Pinned',
      'Work',
      'Personal',
    ]);
  });

  it('reports a failed write once and keeps the app state unchanged', async () => {
    const store = new AppStateStore();
    const onError = vi.fn();
    const { sink } = fakeSink({ write: { ok: false, error: STORAGE_ERRORS.writeFailed } });
    startPersistence(store, sink, store.getSnapshot().state, onError);

    store.dispatch({ type: 'sendMessage', threadId: null, content: 'one' });
    store.dispatch({ type: 'sendMessage', threadId: null, content: 'two' });
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(STORAGE_ERRORS.writeFailed);
    expect(store.getSnapshot().state.recents).toHaveLength(2);
  });

  it('sends nothing after close', async () => {
    const store = new AppStateStore();
    const { sink, requests, close } = fakeSink();
    const persistence = startPersistence(store, sink, store.getSnapshot().state, () => undefined);

    await persistence.close();
    store.dispatch({ type: 'sendMessage', threadId: null, content: 'late' });
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });
});
