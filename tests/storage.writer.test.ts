import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../electron/appStateStore';
import { STORAGE_ERRORS, type StorageOp } from '../electron/storage/protocol';
import {
  startPersistence,
  storageOpsForChange,
  type StorageSink,
} from '../electron/storage/writer';
import { applyAction, createInitialSharedState, type SharedState } from '../shared/appState';
import type { IpcResult } from '../shared/types';

/** Phase 3b: the one writer, which turns state changes into storage ops. */

function send(state: SharedState, content: string): SharedState {
  return applyAction(state, { type: 'sendMessage', threadId: state.activeThreadId, content });
}

function kinds(ops: StorageOp[]): string[] {
  return ops.map((op) => (op.kind === 'saveThread' ? `thread:${op.thread.title}` : `message:${String(op.message.position)}`));
}

describe('storageOpsForChange', () => {
  it('does not save an empty thread', () => {
    const before = createInitialSharedState();
    const after = applyAction(before, { type: 'createThread' });
    expect(after.recents).toHaveLength(1);
    expect(storageOpsForChange(before, after)).toEqual([]);
  });

  it('saves a new thread with its first message', () => {
    const before = createInitialSharedState();
    const after = send(before, 'Plan the storage layer');
    const thread = after.recents[0];

    const ops = storageOpsForChange(before, after);

    expect(ops).toEqual([
      {
        kind: 'saveThread',
        thread: {
          id: thread?.id,
          title: 'Plan the storage layer',
          createdAt: thread?.createdAt,
          updatedAt: thread?.updatedAt,
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

    const ops = storageOpsForChange(first, second);

    expect(kinds(ops).filter((kind) => kind.startsWith('message'))).toEqual(['message:1']);
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
    expect(storageOpsForChange(sent, running).filter((op) => op.kind === 'saveMessage')).toEqual([]);

    const finished = applyAction(running, {
      type: 'finishReply',
      threadId,
      streamId: 's1',
      outcome: { status: 'completed', text: 'hi there' },
    });
    const messages = storageOpsForChange(running, finished).filter(
      (op) => op.kind === 'saveMessage',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      message: { position: 1, role: 'assistant', content: 'hi there' },
    });
  });

  it('saves nothing for changes that do not touch threads, and never deletes', () => {
    const sent = send(createInitialSharedState(), 'hello');
    const collapsed = applyAction(sent, {
      type: 'toggleSectionCollapsed',
      sectionId: 'pinned',
    });
    expect(storageOpsForChange(sent, collapsed)).toEqual([]);

    // A thread gone from memory produces no op at all.
    expect(storageOpsForChange(sent, createInitialSharedState())).toEqual([]);
  });
});

/** Records requests and answers them with `ok` unless told otherwise. */
function fakeSink(answers: { open?: IpcResult<number>; write?: IpcResult<null> } = {}) {
  const requests: unknown[] = [];
  const close = vi.fn(() => Promise.resolve());
  const sink: StorageSink = {
    request: ((request: { type: string }) => {
      requests.push(request);
      const result =
        request.type === 'open'
          ? (answers.open ?? { ok: true, value: 1 })
          : (answers.write ?? { ok: true, value: null });
      return Promise.resolve(result);
    }) as StorageSink['request'],
    close,
  };
  return { sink, requests, close };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('startPersistence', () => {
  it('opens the file, then writes each change in order', async () => {
    const store = new AppStateStore();
    const { sink, requests } = fakeSink();
    startPersistence(store, sink, 'app.db', () => undefined);

    store.dispatch({ type: 'sendMessage', threadId: null, content: 'one' });
    store.dispatch({ type: 'toggleSectionCollapsed', sectionId: 'pinned' });
    store.dispatch({
      type: 'sendMessage',
      threadId: store.getSnapshot().state.activeThreadId,
      content: 'two',
    });
    await flush();

    expect(requests.map((request) => (request as { type: string }).type)).toEqual([
      'open',
      'write',
      'write',
    ]);
  });

  it('stops writing and reports once when the file cannot be opened', async () => {
    const store = new AppStateStore();
    const onError = vi.fn();
    const { sink, requests } = fakeSink({
      open: { ok: false, error: STORAGE_ERRORS.openFailed },
    });
    startPersistence(store, sink, 'app.db', onError);
    await flush();

    store.dispatch({ type: 'sendMessage', threadId: null, content: 'one' });
    await flush();

    expect(requests).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(STORAGE_ERRORS.openFailed);
  });

  it('reports a failed write once and keeps the app state unchanged', async () => {
    const store = new AppStateStore();
    const onError = vi.fn();
    const { sink } = fakeSink({ write: { ok: false, error: STORAGE_ERRORS.writeFailed } });
    startPersistence(store, sink, 'app.db', onError);

    store.dispatch({ type: 'sendMessage', threadId: null, content: 'one' });
    store.dispatch({ type: 'sendMessage', threadId: null, content: 'two' });
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().state.recents).toHaveLength(2);
  });

  it('sends nothing after close', async () => {
    const store = new AppStateStore();
    const { sink, requests, close } = fakeSink();
    const persistence = startPersistence(store, sink, 'app.db', () => undefined);

    await persistence.close();
    store.dispatch({ type: 'sendMessage', threadId: null, content: 'late' });
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });
});
