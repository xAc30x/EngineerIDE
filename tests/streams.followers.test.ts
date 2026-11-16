import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLUSH_INTERVAL_MS, StreamHub } from '../electron/streams/streamHub';
import type { StreamDelta, StreamsApi } from '../shared/ipc/streams';
import { createStreamFollowers, type StreamView } from '../src/hooks/useStream';

/** Lets pending promise callbacks (for example a subscription reply) run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

interface FakeWindow {
  api: StreamsApi;
  calls: { subscribe: [string, number][]; unsubscribe: string[] };
  /** Delivers a delta as if main had sent it to this window. */
  receive: (delta: StreamDelta) => void;
}

/** The bridge one window would get from the preload script, wired to `hub` directly. */
function connectWindow(hub: StreamHub, key: string): FakeWindow {
  const listeners = new Set<(delta: StreamDelta) => void>();
  const receive = (delta: StreamDelta): void => {
    for (const listener of listeners) {
      listener(delta);
    }
  };
  const calls: FakeWindow['calls'] = { subscribe: [], unsubscribe: [] };
  const api: StreamsApi = {
    onStreamData: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeStream: async (streamId, knownChunks) => {
      calls.subscribe.push([streamId, knownChunks]);
      const found = hub.subscribe(streamId, key, knownChunks, (delta) => {
        receive(delta);
        return true;
      });
      return found ? { ok: true, value: null } : { ok: false, error: 'Unknown stream.' };
    },
    unsubscribeStream: async (streamId) => {
      calls.unsubscribe.push(streamId);
      hub.unsubscribe(streamId, key);
      return { ok: true, value: null };
    },
    cancelStream: async (streamId) =>
      hub.cancel(streamId) ? { ok: true, value: null } : { ok: false, error: 'Unknown stream.' },
    startTestStream: async () => ({ ok: false, error: 'Not used here.' }),
  };
  return { api, calls, receive };
}

function consumer(): { latest: () => StreamView | undefined; text: () => string; fn: (view: StreamView) => void } {
  let latest: StreamView | undefined;
  return {
    latest: () => latest,
    text: () => latest?.chunks.join('') ?? '',
    fn: (view) => {
      latest = view;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stream followers in one window', () => {
  it('keeps following for the remaining consumer when another one leaves mid-stream', async () => {
    const hub = new StreamHub();
    const writer = hub.create();
    const window = connectWindow(hub, 'workspace');
    const followers = createStreamFollowers(window.api);
    const chat = consumer();
    const preview = consumer();

    const stopChat = followers.follow(writer.id, chat.fn);
    const stopPreview = followers.follow(writer.id, preview.fn);
    await settle();
    expect(window.calls.subscribe).toHaveLength(1);

    writer.append('Hello');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);
    stopPreview();
    writer.append(' there');
    writer.complete();

    expect(window.calls.unsubscribe).toEqual([]);
    expect(chat.text()).toBe('Hello there');
    expect(chat.latest()?.status).toBe('completed');
    expect(preview.text()).toBe('Hello');
    stopChat();
  });

  it('gives a consumer that joins late the view so far at once', async () => {
    const hub = new StreamHub();
    const writer = hub.create();
    const window = connectWindow(hub, 'workspace');
    const followers = createStreamFollowers(window.api);
    followers.follow(writer.id, () => {});
    writer.append('so far');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);

    const late = consumer();
    followers.follow(writer.id, late.fn);
    expect(late.text()).toBe('so far');
    expect(window.calls.subscribe).toHaveLength(1);
  });

  it('unsubscribes from main when the last consumer leaves, and gets nothing more', async () => {
    const hub = new StreamHub();
    const writer = hub.create();
    const window = connectWindow(hub, 'workspace');
    const followers = createStreamFollowers(window.api);
    const only = consumer();
    const stop = followers.follow(writer.id, only.fn);
    await settle();

    stop();
    await settle();
    writer.append('unseen');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);

    expect(window.calls.unsubscribe).toEqual([writer.id]);
    expect(only.text()).toBe('');
  });

  it('subscribes again from the chunks it has when a delta would leave a gap', async () => {
    const hub = new StreamHub();
    const writer = hub.create();
    const window = connectWindow(hub, 'ide');
    const followers = createStreamFollowers(window.api);
    const view = consumer();
    followers.follow(writer.id, view.fn);
    writer.append('a');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);
    expect(view.text()).toBe('a');

    writer.append('b');
    writer.append('c');
    // A delta that skips chunk 1, as a lost message would.
    window.receive({ streamId: writer.id, startIndex: 2, chunks: ['c'], status: 'running' });
    await settle();

    expect(window.calls.subscribe.at(-1)).toEqual([writer.id, 1]);
    expect(view.text()).toBe('abc');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);
    writer.complete();
    expect(view.text()).toBe('abc');
    expect(view.latest()?.status).toBe('completed');
  });

  it('ignores a gap while its first subscription is still on its way', async () => {
    const hub = new StreamHub();
    const writer = hub.create();
    writer.append('a');
    writer.append('b');
    const window = connectWindow(hub, 'ide');
    // Hold the subscription back until `release()`, as a slow IPC reply would.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const subscribeNow = window.api.subscribeStream;
    const api: StreamsApi = {
      ...window.api,
      subscribeStream: async (streamId, knownChunks) => {
        await gate;
        return subscribeNow(streamId, knownChunks);
      },
    };
    const followers = createStreamFollowers(api);
    const view = consumer();
    followers.follow(writer.id, view.fn);

    // After a reload, the page's old subscription may still deliver a delta
    // addressed to the chunks it had before.
    window.receive({ streamId: writer.id, startIndex: 5, chunks: ['x'], status: 'running' });
    await settle();
    expect(window.calls.subscribe).toEqual([]);

    release();
    await settle();
    expect(window.calls.subscribe).toEqual([[writer.id, 0]]);
    expect(view.text()).toBe('ab');
  });

  it('reports a stream that does not exist', async () => {
    const hub = new StreamHub();
    const window = connectWindow(hub, 'workspace');
    const followers = createStreamFollowers(window.api);
    const view = consumer();
    followers.follow('missing', view.fn);
    await settle();
    expect(view.latest()?.error).toBe('Unknown stream.');
  });
});

describe('stream followers in two windows', () => {
  it('shows the same text in both windows, and a cancel from either stops both', async () => {
    const hub = new StreamHub();
    const writer = hub.create();
    const workspace = connectWindow(hub, 'workspace');
    const ide = connectWindow(hub, 'ide');
    const inWorkspace = consumer();
    const inIde = consumer();
    createStreamFollowers(workspace.api).follow(writer.id, inWorkspace.fn);
    createStreamFollowers(ide.api).follow(writer.id, inIde.fn);
    await settle();

    writer.append('one ');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);
    writer.append('two');
    await ide.api.cancelStream(writer.id);
    writer.append('three');
    await vi.advanceTimersByTimeAsync(DEFAULT_FLUSH_INTERVAL_MS);

    expect(inWorkspace.text()).toBe('one two');
    expect(inIde.text()).toBe('one two');
    expect(inWorkspace.latest()?.status).toBe('cancelled');
    expect(inIde.latest()?.status).toBe('cancelled');
    expect(writer.signal.aborted).toBe(true);
  });
});
