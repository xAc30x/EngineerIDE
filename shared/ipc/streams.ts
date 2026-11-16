import type { IpcResult } from '../types';

export const STREAM_CHANNELS = {
  subscribe: 'stream:subscribe',
  unsubscribe: 'stream:unsubscribe',
  cancel: 'stream:cancel',
  /** Development only: starts a fake stream so the channel can be observed. */
  startTest: 'stream:startTest',
  /** Sent by the main process to a subscribed window: missing chunks, then live ones. */
  data: 'stream:data',
} as const;

/** `running` is the only status that can still change. */
export type StreamStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export function isFinishedStatus(status: StreamStatus): boolean {
  return status !== 'running';
}

/**
 * Part of one stream, sent to one window. `chunks` are the stream's chunks
 * from `startIndex` on, in order, so after applying it the window holds
 * `startIndex + chunks.length` chunks. Every delta carries the stream's
 * current status; a finished stream's last delta may have no chunks.
 */
export interface StreamDelta {
  streamId: string;
  startIndex: number;
  chunks: string[];
  status: StreamStatus;
  /** Why the stream failed. Set only when `status` is `failed`. */
  error?: string;
}

export interface TestStreamOptions {
  /** Number of chunks to produce. */
  chunkCount?: number;
  /** Delay between two chunks, in milliseconds. */
  intervalMs?: number;
}

export interface StreamsApi {
  /**
   * Calls `listener` with every delta sent to this window, for any stream.
   * Register it before `subscribeStream`. Returns a function that stops the calls.
   */
  onStreamData(listener: (delta: StreamDelta) => void): () => void;
  /**
   * Asks main to send this window the stream's chunks from `knownChunks` on,
   * then live ones until it finishes. Subscribing again replaces the earlier
   * subscription. Fails when the stream does not exist or was released.
   */
  subscribeStream(streamId: string, knownChunks: number): Promise<IpcResult<null>>;
  unsubscribeStream(streamId: string): Promise<IpcResult<null>>;
  /** Stops a running stream for every window. */
  cancelStream(streamId: string): Promise<IpcResult<null>>;
  /** Development only (refused in a packaged app): starts a fake stream and returns its id. */
  startTestStream(options?: TestStreamOptions): Promise<IpcResult<string>>;
}
