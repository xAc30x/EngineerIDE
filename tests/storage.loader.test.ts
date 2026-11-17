import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeProvider } from '../electron/ai/fakeProvider';
import { ProviderRegistry } from '../electron/ai/registry';
import { ReplyRunner } from '../electron/ai/replies';
import { AppStateStore } from '../electron/appStateStore';
import type { StoredData, StoredMessage } from '../electron/storage/protocol';
import { buildRestoredState } from '../electron/storage/restore';
import {
  THREAD_NOT_LOADED_ERROR,
  ThreadLoader,
  type MessageSource,
} from '../electron/storage/threadLoader';
import { storageOpsForChange } from '../electron/storage/writer';
import { StreamHub } from '../electron/streams/streamHub';
import { fetchThreadMessages } from '../electron/threadMessages';
import {
  applyAction,
  findThread,
  parseAction,
  toIndexState,
  type SharedState,
} from '../shared/appState';
import { THREADS_ERRORS } from '../shared/ipc/threads';
import type { IpcResult } from '../shared/types';

/**
 * Phase 3c: restored threads keep their messages in the database until main
 * first needs them, and nothing can be added to a thread before that.
 */

const OLD_MESSAGES: StoredMessage[] = [
  { id: 'm0', threadId: 'old', position: 0, role: 'user', content: 'Old question', createdAt: 1 },
  { id: 'm1', threadId: 'old', position: 1, role: 'assistant', content: 'Old answer', createdAt: 2 },
];

/** The state right after launch: one saved thread with two messages, not loaded. */
function restored(): { state: SharedState; saved: SharedState } {
  const data: StoredData = {
    sections: [],
    threads: [
      {
        id: 'old',
        title: 'Old question',
        createdAt: 1,
        updatedAt: 2,
        sectionId: null,
        position: 0,
        messageCount: 2,
      },
    ],
    settings: { activeThreadId: 'old' },
  };
  return buildRestoredState(data);
}

function loaded(state: SharedState): SharedState {
  return applyAction(state, {
    type: 'loadThreadMessages',
    threadId: 'old',
    messages: OLD_MESSAGES.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })),
  });
}

describe('an unloaded thread in the shared state', () => {
  it('shows its stored count to windows', () => {
    expect(findThread(toIndexState(restored().state), 'old')?.messageCount).toBe(2);
  });

  it('takes no new message until it is loaded', () => {
    const { state } = restored();
    expect(applyAction(state, { type: 'sendMessage', threadId: 'old', content: 'more' })).toBe(state);
  });

  it('keeps its title and gets the next position once loaded', () => {
    const before = loaded(restored().state);
    const after = applyAction(before, { type: 'sendMessage', threadId: 'old', content: 'Follow-up' });

    expect(findThread(after, 'old')).toMatchObject({ title: 'Old question', messageCount: 3 });
    expect(storageOpsForChange(before, after)).toContainEqual(
      expect.objectContaining({
        kind: 'saveMessage',
        message: expect.objectContaining({ position: 2, content: 'Follow-up' }),
      }),
    );
  });

  it('is not reused by "New chat", which starts a new thread', () => {
    const { state } = restored();
    const after = applyAction(state, { type: 'createThread' });
    expect(after.activeThreadId).not.toBe('old');
    expect(after.recents).toHaveLength(2);
  });

  it('is saved when it moves, without being loaded', () => {
    const { state } = restored();
    const pinned = applyAction(state, { type: 'togglePinned', threadId: 'old' });
    expect(storageOpsForChange(state, pinned)).toContainEqual({
      kind: 'saveThread',
      thread: expect.objectContaining({ id: 'old', sectionId: 'pinned', position: 0 }),
    });
  });

  it('writes nothing when its messages are loaded', () => {
    const { state } = restored();
    expect(storageOpsForChange(state, loaded(state))).toEqual([]);
  });

  it('is loaded only by main: windows cannot send loadThreadMessages', () => {
    expect(
      parseAction({ type: 'loadThreadMessages', threadId: 'old', messages: [] }),
    ).toBeNull();
    // Loading again does nothing.
    const once = loaded(restored().state);
    expect(applyAction(once, { type: 'loadThreadMessages', threadId: 'old', messages: [] })).toBe(once);
  });
});

/** A store holding the restored state, and a fake database for its messages. */
function setup(answer: () => Promise<IpcResult<StoredMessage[]>>) {
  const store = new AppStateStore();
  store.restore(restored().state);
  const request = vi.fn((_request: { type: 'loadMessages'; threadId: string }) => answer());
  const source: MessageSource = { request };
  const loader = new ThreadLoader(store);
  loader.attach(source);
  return { store, loader, request };
}

describe('ThreadLoader', () => {
  it('reads the messages once and puts them in the state', async () => {
    const { store, loader, request } = setup(async () => ({ ok: true, value: OLD_MESSAGES }));

    const [first, second] = await Promise.all([
      loader.ensureLoaded('old'),
      loader.ensureLoaded('old'),
    ]);

    expect(first).toEqual({ ok: true, value: null });
    expect(second).toEqual({ ok: true, value: null });
    expect(request).toHaveBeenCalledTimes(1);
    expect(findThread(store.getSnapshot().state, 'old')).toMatchObject({
      messagesLoaded: true,
      messageCount: 2,
      messages: [{ content: 'Old question' }, { content: 'Old answer' }],
    });

    await loader.ensureLoaded('old');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('needs nothing for an unknown thread', async () => {
    const { loader, request } = setup(async () => ({ ok: true, value: [] }));
    await expect(loader.ensureLoaded('missing')).resolves.toEqual({ ok: true, value: null });
    expect(request).not.toHaveBeenCalled();
  });

  it('leaves the thread unloaded after a failed read, with a fixed message, and retries later', async () => {
    let fail = true;
    const { store, loader, request } = setup(async () =>
      fail ? { ok: false, error: 'SQLITE_CORRUPT at /home/someone/x.db' } : { ok: true, value: OLD_MESSAGES },
    );

    await expect(loader.ensureLoaded('old')).resolves.toEqual({
      ok: false,
      error: THREAD_NOT_LOADED_ERROR,
    });
    expect(findThread(store.getSnapshot().state, 'old')?.messagesLoaded).toBe(false);

    fail = false;
    await expect(loader.ensureLoaded('old')).resolves.toEqual({ ok: true, value: null });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('fails without a database to read from', async () => {
    const store = new AppStateStore();
    store.restore(restored().state);
    await expect(new ThreadLoader(store).ensureLoaded('old')).resolves.toEqual({
      ok: false,
      error: THREAD_NOT_LOADED_ERROR,
    });
  });
});

describe('fetchThreadMessages', () => {
  it('loads a restored thread, then returns its messages', async () => {
    const { store, loader } = setup(async () => ({ ok: true, value: OLD_MESSAGES }));
    const result = await fetchThreadMessages(store, loader, 'old');
    expect(result.ok && result.value.map((message) => message.content)).toEqual([
      'Old question',
      'Old answer',
    ]);
  });

  it('rejects a malformed id without reading anything', async () => {
    const { store, loader, request } = setup(async () => ({ ok: true, value: [] }));
    await expect(fetchThreadMessages(store, loader, 42)).resolves.toEqual({
      ok: false,
      error: THREADS_ERRORS.invalidRequest,
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('a reply in a restored thread', () => {
  let hub: StreamHub | undefined;
  afterEach(() => hub?.dispose());

  it('is refused until the thread is loaded', async () => {
    hub = new StreamHub({ flushIntervalMs: 1 });
    const { store, loader } = setup(async () => ({ ok: true, value: OLD_MESSAGES }));
    const registry = new ProviderRegistry({ allowTestStandIn: false });
    registry.register(createFakeProvider({ id: 'claude-cli', label: 'Fake', chunkCount: 1, intervalMs: 0 }));
    const runner = new ReplyRunner({ hub, appState: store, registry });

    expect(runner.send('old', 'More please')).toEqual({ ok: false, error: THREAD_NOT_LOADED_ERROR });
    expect(findThread(store.getSnapshot().state, 'old')?.messageCount).toBe(2);

    await loader.ensureLoaded('old');
    expect(runner.send('old', 'More please').ok).toBe(true);
    expect(findThread(store.getSnapshot().state, 'old')?.messages.map((m) => m.content)).toEqual([
      'Old question',
      'Old answer',
      'More please',
    ]);
  });
});
