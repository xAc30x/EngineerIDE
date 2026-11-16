import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AIChatRequest, AIProviderAdapter, AIStreamEvent } from '../electron/ai/adapter';
import { createFakeProvider, fakeChunkText } from '../electron/ai/fakeProvider';
import { ProviderRegistry } from '../electron/ai/registry';
import {
  EMPTY_MESSAGE_ERROR,
  NOT_REPLYING_ERROR,
  ReplyRunner,
  THREAD_BUSY_ERROR,
} from '../electron/ai/replies';
import { AppStateStore } from '../electron/appStateStore';
import { StreamHub } from '../electron/streams/streamHub';
import { findThread } from '../shared/appState';
import type { StateApi } from '../shared/ipc/state';
import type { Thread } from '../shared/types';
import { createAppStore } from '../src/store/useAppStore';

let hub: StreamHub;
let appState: AppStateStore;
let registry: ProviderRegistry;
let runner: ReplyRunner;

beforeEach(() => {
  hub = new StreamHub({ flushIntervalMs: 1 });
  appState = new AppStateStore();
  registry = new ProviderRegistry({ allowTestStandIn: false });
  registry.register(createFakeProvider({ id: 'claude-cli', label: 'Fake', chunkCount: 3, intervalMs: 0 }));
  runner = new ReplyRunner({ hub, appState, registry });
});

afterEach(() => {
  hub.dispose();
});

function thread(threadId: string): Thread {
  const found = findThread(appState.getSnapshot().state, threadId);
  if (found === undefined) {
    throw new Error(`Expected thread ${threadId} to exist.`);
  }
  return found;
}

/** Waits until `check` is true, failing after a second. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function send(threadId: string | null, content: string) {
  const result = runner.send(threadId, content);
  if (!result.ok) {
    throw new Error(`Expected the send to be accepted: ${result.error}`);
  }
  return result.value;
}

/**
 * An adapter that yields one chunk, then waits until the request is aborted.
 * `stopped` turns true however it ends: by its signal, or by the runner
 * closing the generator.
 */
function hangingProvider(): { adapter: AIProviderAdapter; stopped: () => boolean } {
  let wasStopped = false;
  return {
    stopped: () => wasStopped,
    adapter: {
      id: 'openrouter',
      label: 'Hanging',
      checkAvailability: async () => ({ available: true }),
      async *streamChat(request: AIChatRequest): AsyncIterable<AIStreamEvent> {
        try {
          yield { type: 'text-delta', text: 'Partial' };
          await new Promise<void>((resolve) =>
            request.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        } finally {
          wasStopped = true;
        }
      },
    },
  };
}

function useHangingProvider() {
  const hanging = hangingProvider();
  registry.register(hanging.adapter);
  appState.dispatch({ type: 'setSelectedBackend', backend: 'openrouter' });
  return hanging;
}

describe('ReplyRunner.send', () => {
  it('creates a thread for a null id, adds the user message, and marks the reply as running', () => {
    const { threadId, streamId } = send(null, 'Hello');
    const current = thread(threadId);
    expect(current.messages.map((m) => [m.role, m.content])).toEqual([['user', 'Hello']]);
    expect(current.runningReply).toEqual({ streamId, provider: 'claude-cli' });
    expect(appState.getSnapshot().state.activeThreadId).toBe(threadId);
  });

  it('streams the provider output and clears the lock when it completes', async () => {
    const { threadId, streamId } = send(null, 'Hello');
    const deltas: string[] = [];
    hub.subscribe(streamId, 'window', 0, (delta) => {
      deltas.push(...delta.chunks);
      return true;
    });
    await until(() => thread(threadId).runningReply === null);
    expect(deltas.join('')).toBe(
      `You said: "Hello". ${[0, 1, 2].map((i) => fakeChunkText(i, 3)).join('')}`,
    );
  });

  it('stores the finished reply in the thread', async () => {
    const { threadId } = send(null, 'Hello');
    await until(() => thread(threadId).runningReply === null);
    const last = thread(threadId).messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content.startsWith('You said: "Hello". ')).toBe(true);
  });

  it('releases the stream once the reply is stored', async () => {
    const { threadId, streamId } = send(null, 'Hello');
    await until(() => thread(threadId).runningReply === null);
    expect(hub.getStatus(streamId)).toBeUndefined();
  });

  it('sends the conversation without system messages and with the project path', async () => {
    let seen: AIChatRequest | undefined;
    registry.register({
      id: 'claude-cli',
      label: 'Spy',
      checkAvailability: async () => ({ available: true }),
      async *streamChat(request) {
        seen = request;
        yield { type: 'completed' };
      },
    });
    appState.dispatch({ type: 'setActiveProject', folder: { path: '/work/app', name: 'app' } });
    const { threadId } = send(null, 'First');
    await until(() => thread(threadId).runningReply === null);
    send(threadId, 'Second');
    await until(() => thread(threadId).runningReply === null);
    expect(seen?.projectPath).toBe('/work/app');
    expect(seen?.messages.every((m) => m.role !== 'system')).toBe(true);
    expect(seen?.messages.at(-1)?.content).toBe('Second');
  });
});

describe('the run lock', () => {
  it('refuses a second send to a replying thread and adds no message', () => {
    useHangingProvider();
    const { threadId } = send(null, 'First');
    const before = appState.getSnapshot().version;
    expect(runner.send(threadId, 'Second')).toEqual({ ok: false, error: THREAD_BUSY_ERROR });
    expect(appState.getSnapshot().version).toBe(before);
  });

  it('accepts exactly one of two sends fired back to back', () => {
    useHangingProvider();
    const { threadId } = send(null, 'Start');
    runner.cancel(threadId);
    // The cancel finishes the stream; its outcome is stored on a later tick.
    const results = [runner.send(null, 'A'), runner.send(appState.getSnapshot().state.activeThreadId, 'B')];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it('lets a different thread reply at the same time', () => {
    useHangingProvider();
    const first = send(null, 'First');
    appState.dispatch({ type: 'createThread', sectionId: appState.getSnapshot().state.sections[1]?.id });
    const second = send(appState.getSnapshot().state.activeThreadId, 'Second');
    expect(second.threadId).not.toBe(first.threadId);
    expect(thread(first.threadId).runningReply).not.toBeNull();
    expect(thread(second.threadId).runningReply).not.toBeNull();
  });

  it('frees the thread after the reply ends, so the next send is accepted', async () => {
    const { threadId } = send(null, 'First');
    await until(() => thread(threadId).runningReply === null);
    expect(runner.send(threadId, 'Second').ok).toBe(true);
  });
});

describe('refused sends change nothing', () => {
  it('refuses a blank message', () => {
    const before = appState.getSnapshot().version;
    expect(runner.send(null, '   ')).toEqual({ ok: false, error: EMPTY_MESSAGE_ERROR });
    expect(appState.getSnapshot().version).toBe(before);
  });

  it('refuses a backend with no adapter, with its reason', () => {
    appState.dispatch({ type: 'setSelectedBackend', backend: 'openai-api' });
    const before = appState.getSnapshot().version;
    const result = runner.send(null, 'Hello');
    expect(result).toEqual({ ok: false, error: 'OpenAI API is not available yet.' });
    expect(appState.getSnapshot().version).toBe(before);
  });
});

describe('failure and cancellation', () => {
  it('clears the lock and releases the stream when the provider reports an error', async () => {
    registry.register(
      createFakeProvider({ id: 'claude-cli', label: 'Failing', chunkCount: 1, intervalMs: 0, failWith: 'Quota used up' }),
    );
    const { threadId, streamId } = send(null, 'Hello');
    let failure: string | undefined;
    hub.subscribe(streamId, 'window', 0, (delta) => {
      failure = delta.error ?? failure;
      return true;
    });
    await until(() => thread(threadId).runningReply === null);
    expect(failure).toBe('Quota used up');
    expect(hub.getStatus(streamId)).toBeUndefined();
  });

  it('treats an adapter that throws as a failure', async () => {
    registry.register({
      id: 'claude-cli',
      label: 'Throwing',
      checkAvailability: async () => ({ available: true }),
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error('Process exited');
      },
    });
    const { threadId, streamId } = send(null, 'Hello');
    let status: string | undefined;
    hub.subscribe(streamId, 'window', 0, (delta) => {
      status = delta.status;
      return true;
    });
    await until(() => thread(threadId).runningReply === null);
    expect(status).toBe('failed');
  });

  it('cancel stops the provider and frees the thread', async () => {
    const hanging = useHangingProvider();
    const { threadId } = send(null, 'Hello');
    expect(runner.cancel(threadId)).toEqual({ ok: true, value: null });
    await until(() => thread(threadId).runningReply === null);
    await until(hanging.stopped);
  });

  it('refuses to cancel a thread that is not replying', () => {
    expect(runner.cancel('nope')).toEqual({ ok: false, error: NOT_REPLYING_ERROR });
  });
});

describe('two windows', () => {
  function connectWindow(main: AppStateStore): StateApi {
    return {
      getAppState: async () => ({ ok: true, value: main.getSnapshot() }),
      dispatch: async (action) => {
        main.dispatch(action);
        return { ok: true, value: null };
      },
      onStateChanged: (listener) => main.subscribe(listener),
    };
  }

  it('both windows see the running reply, then its end', async () => {
    const workspace = createAppStore(connectWindow(appState));
    const ide = createAppStore(connectWindow(appState));
    const { threadId, streamId } = send(null, 'Hello');
    for (const store of [workspace, ide]) {
      expect(findThread(store.getState(), threadId)?.runningReply?.streamId).toBe(streamId);
    }
    await until(() => thread(threadId).runningReply === null);
    for (const store of [workspace, ide]) {
      expect(findThread(store.getState(), threadId)?.runningReply).toBeNull();
      expect(findThread(store.getState(), threadId)?.messages).toEqual(thread(threadId).messages);
    }
  });
});
