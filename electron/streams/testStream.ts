import type { TestStreamOptions } from '../../shared/ipc/streams';
import type { StreamHub } from './streamHub';

/** About 12 seconds of output: long enough to reload or cancel a window mid-stream. */
export const TEST_STREAM_DEFAULTS: Required<TestStreamOptions> = {
  chunkCount: 100,
  intervalMs: 120,
};

const MAX_CHUNK_COUNT = 10_000;
const MIN_INTERVAL_MS = 1;
const MAX_INTERVAL_MS = 5_000;

/** The text of chunk `index` (from 0), so a test can predict the whole output. */
export function testChunkText(index: number, chunkCount: number): string {
  return `Chunk ${index + 1} of ${chunkCount}. `;
}

/**
 * Reads the untrusted options sent by a window. Returns `null` when they are
 * malformed; missing fields take the defaults.
 */
export function parseTestStreamOptions(value: unknown): Required<TestStreamOptions> | null {
  if (value === undefined || value === null) {
    return { ...TEST_STREAM_DEFAULTS };
  }
  if (typeof value !== 'object') {
    return null;
  }
  const { chunkCount = TEST_STREAM_DEFAULTS.chunkCount, intervalMs = TEST_STREAM_DEFAULTS.intervalMs } =
    value as Record<string, unknown>;
  if (!isIntegerInRange(chunkCount, 1, MAX_CHUNK_COUNT)) {
    return null;
  }
  if (!isIntegerInRange(intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS)) {
    return null;
  }
  return { chunkCount, intervalMs };
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * A stand-in producer for development: appends one numbered chunk every
 * `intervalMs`, then completes. It stops as soon as the stream is cancelled.
 * Returns the stream id.
 */
export function startTestStream(hub: StreamHub, options: Required<TestStreamOptions>): string {
  const writer = hub.create();
  let produced = 0;
  const timer = setInterval(() => {
    writer.append(testChunkText(produced, options.chunkCount));
    produced += 1;
    if (produced >= options.chunkCount) {
      clearInterval(timer);
      writer.complete();
    }
  }, options.intervalMs);
  writer.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  return writer.id;
}
