import { randomUUID } from 'node:crypto';
import { isFinishedStatus, type StreamDelta, type StreamStatus } from '../../shared/ipc/streams';

/** How long chunks are collected before they are sent, in milliseconds. */
export const DEFAULT_FLUSH_INTERVAL_MS = 30;

/**
 * Delivers a delta to one receiver (in the app, one window). Returns `false`
 * when the receiver is gone, which ends its subscriptions.
 */
export type DeltaSink = (delta: StreamDelta) => boolean;

/** Identifies a receiver, so subscribing again replaces its earlier subscription. */
export type SubscriberKey = string | number;

/** How a stream ended. */
export interface FinishedStream {
  streamId: string;
  status: Exclude<StreamStatus, 'running'>;
  /** All chunks joined. */
  text: string;
  /** Set only when `status` is `failed`. */
  error?: string;
}

/** What a producer (later, an AI provider) uses to write one stream. */
export interface StreamWriter {
  readonly id: string;
  /** Aborted when the stream is cancelled. The producer must stop when it fires. */
  readonly signal: AbortSignal;
  /** Adds a chunk. Ignored once the stream has finished. */
  append(text: string): void;
  complete(): void;
  fail(message: string): void;
  /** Resolves once, when the stream finishes for any reason. Never rejects. */
  readonly finished: Promise<FinishedStream>;
}

export interface StreamHubOptions {
  flushIntervalMs?: number;
  createId?: () => string;
}

interface Subscription {
  sink: DeltaSink;
  /** Index of the first chunk this receiver does not have yet. */
  nextIndex: number;
}

interface StreamRecord {
  id: string;
  status: StreamStatus;
  error?: string;
  chunks: string[];
  controller: AbortController;
  subscriptions: Map<SubscriberKey, Subscription>;
  resolveFinished: (result: FinishedStream) => void;
}

/**
 * Owns every stream's chunks and status, and sends each subscriber the
 * chunks it does not have yet. Chunks are batched: appends arm one timer and
 * every subscriber gets everything new when it fires. A finished stream is
 * sent at once with its final status, so nothing waits for the timer.
 *
 * No Electron imports, so it can be unit-tested. `electron/ipc/streams.ts`
 * connects it to windows.
 */
export class StreamHub {
  private readonly streams = new Map<string, StreamRecord>();
  /** Streams with chunks that have not been sent yet. */
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;
  private readonly createId: () => string;

  constructor(options: StreamHubOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.createId = options.createId ?? randomUUID;
  }

  /** Starts a new, empty, running stream. */
  create(): StreamWriter {
    const id = this.createId();
    let resolveFinished!: (result: FinishedStream) => void;
    const finished = new Promise<FinishedStream>((resolve) => {
      resolveFinished = resolve;
    });
    const record: StreamRecord = {
      id,
      status: 'running',
      chunks: [],
      controller: new AbortController(),
      subscriptions: new Map(),
      resolveFinished,
    };
    this.streams.set(id, record);
    return {
      id,
      signal: record.controller.signal,
      append: (text) => this.append(record, text),
      complete: () => this.finish(record, 'completed'),
      fail: (message) => this.finish(record, 'failed', message),
      finished,
    };
  }

  /** The stream's status, or `undefined` when it does not exist or was released. */
  getStatus(streamId: string): StreamStatus | undefined {
    return this.streams.get(streamId)?.status;
  }

  /** All chunks so far, joined. `undefined` when the stream does not exist or was released. */
  getText(streamId: string): string | undefined {
    return this.streams.get(streamId)?.chunks.join('');
  }

  /**
   * Sends `sink` the chunks from `knownChunks` on right away (with the
   * current status, even when nothing is missing), then live ones until the
   * stream finishes. A second call with the same `key` replaces the first,
   * which is how a reloaded window catches up. Returns `false` when the
   * stream does not exist.
   */
  subscribe(streamId: string, key: SubscriberKey, knownChunks: number, sink: DeltaSink): boolean {
    const record = this.streams.get(streamId);
    if (record === undefined) {
      return false;
    }
    const startIndex = Math.min(Math.max(0, Math.floor(knownChunks)), record.chunks.length);
    const subscription: Subscription = { sink, nextIndex: startIndex };
    record.subscriptions.delete(key);
    const isReceiverAlive = this.deliver(record, subscription, true);
    // A finished stream has nothing more to send, so it keeps no subscription.
    if (isReceiverAlive && record.status === 'running') {
      record.subscriptions.set(key, subscription);
    }
    return true;
  }

  unsubscribe(streamId: string, key: SubscriberKey): void {
    this.streams.get(streamId)?.subscriptions.delete(key);
  }

  /** Ends every subscription of one receiver, for example a closed window. */
  removeSubscriber(key: SubscriberKey): void {
    for (const record of this.streams.values()) {
      record.subscriptions.delete(key);
    }
  }

  /**
   * Stops a running stream: its status becomes `cancelled`, its producer's
   * signal is aborted, and later appends are ignored. Returns `false` when
   * the stream does not exist. Cancelling a finished stream changes nothing.
   */
  cancel(streamId: string): boolean {
    const record = this.streams.get(streamId);
    if (record === undefined) {
      return false;
    }
    if (this.finish(record, 'cancelled')) {
      record.controller.abort();
    }
    return true;
  }

  /**
   * Drops a finished stream's chunks. Call it once the text is stored
   * elsewhere (from Phase 2b, in the shared state). Returns `false` when the
   * stream does not exist or is still running.
   */
  release(streamId: string): boolean {
    const record = this.streams.get(streamId);
    if (record === undefined || !isFinishedStatus(record.status)) {
      return false;
    }
    this.streams.delete(streamId);
    this.dirty.delete(streamId);
    return true;
  }

  /** Cancels every running stream and stops the timer. Used when the app quits. */
  dispose(): void {
    for (const streamId of [...this.streams.keys()]) {
      this.cancel(streamId);
    }
    this.stopTimer();
  }

  private append(record: StreamRecord, text: string): void {
    if (record.status !== 'running' || text.length === 0) {
      return;
    }
    record.chunks.push(text);
    this.dirty.add(record.id);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /** Returns `false` when the stream had already finished. */
  private finish(
    record: StreamRecord,
    status: FinishedStream['status'],
    error?: string,
  ): boolean {
    if (record.status !== 'running') {
      return false;
    }
    record.status = status;
    if (error !== undefined) {
      record.error = error;
    }
    // Pending chunks go out now, together with the final status.
    this.dirty.delete(record.id);
    for (const subscription of record.subscriptions.values()) {
      this.deliver(record, subscription, true);
    }
    record.subscriptions.clear();
    if (this.dirty.size === 0) {
      this.stopTimer();
    }
    record.resolveFinished({
      streamId: record.id,
      status,
      text: record.chunks.join(''),
      ...(error === undefined ? {} : { error }),
    });
    return true;
  }

  private flush(): void {
    this.timer = null;
    const streamIds = [...this.dirty];
    this.dirty.clear();
    for (const streamId of streamIds) {
      const record = this.streams.get(streamId);
      if (record === undefined) {
        continue;
      }
      for (const [key, subscription] of record.subscriptions) {
        if (!this.deliver(record, subscription, false)) {
          record.subscriptions.delete(key);
        }
      }
    }
  }

  /**
   * Sends the subscriber what it is missing. With `always`, a delta goes out
   * even when no chunk is missing, so the receiver learns the status.
   * Returns `false` when the receiver is gone.
   */
  private deliver(record: StreamRecord, subscription: Subscription, always: boolean): boolean {
    const startIndex = subscription.nextIndex;
    if (!always && startIndex >= record.chunks.length) {
      return true;
    }
    const delta: StreamDelta = {
      streamId: record.id,
      startIndex,
      chunks: record.chunks.slice(startIndex),
      status: record.status,
      ...(record.error === undefined ? {} : { error: record.error }),
    };
    subscription.nextIndex = record.chunks.length;
    // A failing receiver must not break the stream for the others, and this
    // can run from a timer, where an exception would reach the main process.
    try {
      return subscription.sink(delta);
    } catch {
      return false;
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
