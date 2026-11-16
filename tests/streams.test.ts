import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseKnownChunks, parseStreamId } from '../electron/streams/requests';
import { DEFAULT_FLUSH_INTERVAL_MS, StreamHub } from '../electron/streams/streamHub';
import {
  parseTestStreamOptions,
  startTestStream,
  TEST_STREAM_DEFAULTS,
  testChunkText,
} from '../electron/streams/testStream';
import type { StreamDelta } from '../shared/ipc/streams';
import { applyStreamDelta, EMPTY_STREAM_VIEW, type StreamView } from '../src/hooks/useStream';

/** A receiver that records every delta, standing in for one window. */
function recorder(): { deltas: StreamDelta[]; sink: (delta: StreamDelta) => boolean } {
  const deltas: StreamDelta[] = [];
  return {
    deltas,
    sink: (delta) => {
      deltas.push(delta);
      return true;
    },
  };
}

/** A window's view of one stream, built the way `useStream` builds it. */
function windowView(): {
  get: () => StreamView;
  text: () => string;
  gaps: () => number;
  sink: (delta: StreamDelta) => boolean;
} {
  let view = EMPTY_STREAM_VIEW;
  let gaps = 0;
  return {
    get: () => view,
    text: () => view.chunks.join(''),
    gaps: () => gaps,
    sink: (delta) => {
      const { view: next, outcome } = applyStreamDelta(view, delta);
      if (outcome === 'gap') {
        gaps += 1;
      } else {
        view = next;
      }
      return true;
    },
  };
}

let nextId = 0;
function createHub(): StreamHub {
  return new StreamHub({ createId: () => `stream-${++nextId}` });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StreamHub batching', () => {
  it('holds chunks back until the flush interval, then sends them in one delta', () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'a', 0, window.sink);
    window.deltas.length = 0; // Ignore the subscribe reply.

    writer.append('Hel');
    writer.append('lo');
    writer.append(' world');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS - 1);
    expect(window.deltas).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(window.deltas).toEqual([
      { streamId: writer.id, startIndex: 0, chunks: ['Hel', 'lo', ' world'], status: 'running' },
    ]);
  });

  it('continues each delta where the previous one ended', () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'a', 0, window.sink);
    window.deltas.length = 0;

    writer.append('one');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    writer.append('two');
    writer.append('three');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);

    expect(window.deltas.map((delta) => [delta.startIndex, delta.chunks])).toEqual([
      [0, ['one']],
      [1, ['two', 'three']],
    ]);
  });

  it('sends nothing and keeps no timer while there is nothing new', () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'a', 0, window.sink);
    window.deltas.length = 0;

    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS * 10);
    expect(window.deltas).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends pending chunks with the final status at once when the stream completes', () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'a', 0, window.sink);
    window.deltas.length = 0;

    writer.append('last words');
    writer.complete();

    expect(window.deltas).toEqual([
      { streamId: writer.id, startIndex: 0, chunks: ['last words'], status: 'completed' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends the failure message with a failed stream', async () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'a', 0, window.sink);

    writer.append('partial');
    writer.fail('Provider crashed.');

    expect(window.deltas.at(-1)).toMatchObject({ status: 'failed', error: 'Provider crashed.' });
    await expect(writer.finished).resolves.toEqual({
      streamId: writer.id,
      status: 'failed',
      text: 'partial',
      error: 'Provider crashed.',
    });
  });

  it('delivers the same chunks to two windows', () => {
    const hub = createHub();
    const writer = hub.create();
    const workspace = windowView();
    const ide = windowView();
    hub.subscribe(writer.id, 'workspace', 0, workspace.sink);
    hub.subscribe(writer.id, 'ide', 0, ide.sink);

    writer.append('a');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    writer.append('b');
    writer.complete();

    expect(workspace.text()).toBe('ab');
    expect(ide.text()).toBe('ab');
    expect(workspace.get().status).toBe('completed');
    expect(ide.get().status).toBe('completed');
  });

  it('ignores empty chunks and chunks appended after the stream finished', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('');
    writer.append('kept');
    writer.complete();
    writer.append('ignored');
    writer.fail('ignored too');

    expect(hub.getText(writer.id)).toBe('kept');
    expect(hub.getStatus(writer.id)).toBe('completed');
  });

  it('drops a receiver that reports it is gone, and one that throws', () => {
    const hub = createHub();
    const writer = hub.create();
    let goneCalls = 0;
    let throwingCalls = 0;
    const healthy = recorder();
    hub.subscribe(writer.id, 'gone', 0, () => {
      goneCalls += 1;
      return goneCalls === 1; // Alive for the subscribe reply only.
    });
    hub.subscribe(writer.id, 'throws', 0, () => {
      throwingCalls += 1;
      if (throwingCalls > 1) {
        throw new Error('Window destroyed.');
      }
      return true;
    });
    hub.subscribe(writer.id, 'healthy', 0, healthy.sink);

    writer.append('x');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    writer.append('y');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);

    expect(goneCalls).toBe(2);
    expect(throwingCalls).toBe(2);
    expect(healthy.deltas.flatMap((delta) => delta.chunks)).toEqual(['x', 'y']);
  });
});

describe('StreamHub replay from an offset', () => {
  it('replies to a subscription with the chunks from the given offset, then live ones', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('a');
    writer.append('b');
    writer.append('c');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);

    const window = recorder();
    hub.subscribe(writer.id, 'late', 1, window.sink);
    expect(window.deltas).toEqual([
      { streamId: writer.id, startIndex: 1, chunks: ['b', 'c'], status: 'running' },
    ]);

    writer.append('d');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    expect(window.deltas.at(-1)).toMatchObject({ startIndex: 3, chunks: ['d'] });
  });

  it('includes chunks that are still waiting for the timer, without sending them twice', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('a');
    const window = windowView();
    hub.subscribe(writer.id, 'w', 0, window.sink);
    expect(window.text()).toBe('a');

    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    writer.append('b');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    expect(window.text()).toBe('ab');
  });

  it('tells a window that already has everything the current status', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('a');
    const window = recorder();
    hub.subscribe(writer.id, 'w', 1, window.sink);
    expect(window.deltas).toEqual([
      { streamId: writer.id, startIndex: 1, chunks: [], status: 'running' },
    ]);
  });

  it('clamps an offset beyond the end to the number of chunks', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('a');
    const window = recorder();
    hub.subscribe(writer.id, 'w', 99, window.sink);
    expect(window.deltas[0]).toMatchObject({ startIndex: 1, chunks: [] });
  });

  it('replays a finished stream in full and keeps no subscription', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('done');
    writer.complete();

    const window = windowView();
    hub.subscribe(writer.id, 'w', 0, window.sink);
    expect(window.text()).toBe('done');
    expect(window.get().status).toBe('completed');
  });

  it('refuses a subscription to an unknown stream', () => {
    const hub = createHub();
    expect(hub.subscribe('missing', 'w', 0, recorder().sink)).toBe(false);
  });

  it('lets a reloaded window catch up without repeating text', () => {
    const hub = createHub();
    const writer = hub.create();
    const other = windowView();
    hub.subscribe(writer.id, 'other', 0, other.sink);
    writer.append('first ');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);

    // The page is reloaded: same receiver key, an empty view, offset 0.
    const reloaded = windowView();
    hub.subscribe(writer.id, 'reloading', 0, () => true);
    hub.subscribe(writer.id, 'reloading', 0, reloaded.sink);
    expect(reloaded.text()).toBe('first ');

    writer.append('second');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    writer.complete();

    expect(reloaded.text()).toBe('first second');
    expect(other.text()).toBe('first second');
  });

  it('subscribing again with the same key replaces the old subscription', () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'w', 0, window.sink);
    hub.subscribe(writer.id, 'w', 0, window.sink);
    window.deltas.length = 0;

    writer.append('once');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);
    expect(window.deltas).toHaveLength(1);
  });

  it('stops sending after unsubscribe and after the receiver is removed', () => {
    const hub = createHub();
    const writer = hub.create();
    const a = recorder();
    const b = recorder();
    hub.subscribe(writer.id, 'a', 0, a.sink);
    hub.subscribe(writer.id, 'b', 0, b.sink);
    hub.unsubscribe(writer.id, 'a');
    hub.removeSubscriber('b');
    a.deltas.length = 0;
    b.deltas.length = 0;

    writer.append('x');
    writer.complete();
    expect(a.deltas).toEqual([]);
    expect(b.deltas).toEqual([]);
  });
});

describe('applyStreamDelta', () => {
  const delta = (startIndex: number, chunks: string[]): StreamDelta => ({
    streamId: 's',
    startIndex,
    chunks,
    status: 'running',
  });

  it('appends a delta that starts at the end of what the window has', () => {
    const { view, outcome } = applyStreamDelta(EMPTY_STREAM_VIEW, delta(0, ['a', 'b']));
    expect(outcome).toBe('applied');
    expect(view).toEqual({ chunks: ['a', 'b'], status: 'running', error: null });
  });

  it('skips chunks the window already has', () => {
    const start = applyStreamDelta(EMPTY_STREAM_VIEW, delta(0, ['a', 'b'])).view;
    const { view } = applyStreamDelta(start, delta(1, ['b', 'c']));
    expect(view.chunks).toEqual(['a', 'b', 'c']);
  });

  it('reports a gap instead of applying a delta that starts past the end', () => {
    const start = applyStreamDelta(EMPTY_STREAM_VIEW, delta(0, ['a'])).view;
    const result = applyStreamDelta(start, delta(3, ['d']));
    expect(result.outcome).toBe('gap');
    expect(result.view).toBe(start);
  });

  it('takes the status and failure message from the delta', () => {
    const { view } = applyStreamDelta(EMPTY_STREAM_VIEW, {
      ...delta(0, []),
      status: 'failed',
      error: 'Boom.',
    });
    expect(view).toMatchObject({ status: 'failed', error: 'Boom.' });
  });
});

describe('StreamHub cancel', () => {
  it('marks the stream cancelled for every window and aborts the producer', async () => {
    const hub = createHub();
    const writer = hub.create();
    const starter = windowView();
    const other = windowView();
    hub.subscribe(writer.id, 'starter', 0, starter.sink);
    hub.subscribe(writer.id, 'other', 0, other.sink);
    writer.append('before');

    expect(hub.cancel(writer.id)).toBe(true);

    expect(writer.signal.aborted).toBe(true);
    expect(starter.get()).toMatchObject({ status: 'cancelled' });
    expect(other.get()).toMatchObject({ status: 'cancelled' });
    // Chunks produced before the cancel are still delivered.
    expect(other.text()).toBe('before');
    await expect(writer.finished).resolves.toMatchObject({
      status: 'cancelled',
      text: 'before',
    });
  });

  it('ignores chunks that arrive after the cancel', () => {
    const hub = createHub();
    const writer = hub.create();
    const window = recorder();
    hub.subscribe(writer.id, 'w', 0, window.sink);
    hub.cancel(writer.id);
    const sent = window.deltas.length;

    writer.append('too late');
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS);

    expect(window.deltas).toHaveLength(sent);
    expect(hub.getText(writer.id)).toBe('');
  });

  it('does not change a stream that has already finished', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.complete();
    expect(hub.cancel(writer.id)).toBe(true);
    expect(hub.getStatus(writer.id)).toBe('completed');
    expect(writer.signal.aborted).toBe(false);
  });

  it('refuses to cancel an unknown stream', () => {
    expect(createHub().cancel('missing')).toBe(false);
  });

  it('stops the test producer', () => {
    const hub = createHub();
    const streamId = startTestStream(hub, { chunkCount: 10, intervalMs: 100 });
    vi.advanceTimersByTime(250);
    expect(hub.getText(streamId)).toBe(testChunkText(0, 10) + testChunkText(1, 10));

    hub.cancel(streamId);
    vi.advanceTimersByTime(10_000);

    expect(hub.getStatus(streamId)).toBe('cancelled');
    expect(hub.getText(streamId)).toBe(testChunkText(0, 10) + testChunkText(1, 10));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose cancels every running stream and leaves no timer', () => {
    const hub = createHub();
    const first = startTestStream(hub, { chunkCount: 10, intervalMs: 10 });
    const second = hub.create();
    second.append('pending');

    hub.dispose();

    expect(hub.getStatus(first)).toBe('cancelled');
    expect(hub.getStatus(second.id)).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('StreamHub cleanup', () => {
  it('releases a finished stream', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('text');
    writer.complete();

    expect(hub.release(writer.id)).toBe(true);

    expect(hub.getStatus(writer.id)).toBeUndefined();
    expect(hub.getText(writer.id)).toBeUndefined();
    expect(hub.subscribe(writer.id, 'w', 0, recorder().sink)).toBe(false);
    expect(hub.cancel(writer.id)).toBe(false);
  });

  it('keeps a running stream', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('text');

    expect(hub.release(writer.id)).toBe(false);
    expect(hub.getText(writer.id)).toBe('text');
  });

  it('releases cancelled and failed streams, and refuses unknown ids', () => {
    const hub = createHub();
    const cancelled = hub.create();
    const failed = hub.create();
    hub.cancel(cancelled.id);
    failed.fail('No.');

    expect(hub.release(cancelled.id)).toBe(true);
    expect(hub.release(failed.id)).toBe(true);
    expect(hub.release(cancelled.id)).toBe(false);
  });

  it('does not send a released stream that still had pending chunks', () => {
    const hub = createHub();
    const writer = hub.create();
    writer.append('x');
    hub.cancel(writer.id);
    hub.release(writer.id);

    expect(() => vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('test stream producer', () => {
  it('produces numbered chunks, then completes', async () => {
    const hub = createHub();
    const streamId = startTestStream(hub, { chunkCount: 3, intervalMs: 50 });
    const window = windowView();
    hub.subscribe(streamId, 'w', 0, window.sink);

    vi.advanceTimersByTime(150);

    expect(window.text()).toBe('Chunk 1 of 3. Chunk 2 of 3. Chunk 3 of 3. ');
    expect(window.get().status).toBe('completed');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('stream request validation', () => {
  it('accepts stream ids and chunk counts', () => {
    expect(parseStreamId('abc')).toBe('abc');
    expect(parseKnownChunks(0)).toBe(0);
    expect(parseKnownChunks(42)).toBe(42);
  });

  it('rejects malformed stream ids', () => {
    for (const value of [undefined, null, 1, '', 'x'.repeat(201), {}, ['id']]) {
      expect(parseStreamId(value)).toBeNull();
    }
  });

  it('rejects malformed chunk counts', () => {
    for (const value of [undefined, null, -1, 1.5, Number.NaN, Infinity, '3', {}]) {
      expect(parseKnownChunks(value)).toBeNull();
    }
  });

  it('fills in test stream defaults and rejects bad options', () => {
    expect(parseTestStreamOptions(undefined)).toEqual(TEST_STREAM_DEFAULTS);
    expect(parseTestStreamOptions({ chunkCount: 5 })).toEqual({
      chunkCount: 5,
      intervalMs: TEST_STREAM_DEFAULTS.intervalMs,
    });
    for (const value of [
      'fast',
      { chunkCount: 0 },
      { chunkCount: 1.5 },
      { chunkCount: 10_001 },
      { intervalMs: 0 },
      { intervalMs: '10' },
    ]) {
      expect(parseTestStreamOptions(value)).toBeNull();
    }
  });
});
