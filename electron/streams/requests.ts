/** Validation of the untrusted stream requests that windows send. No Electron imports. */

const MAX_STREAM_ID_LENGTH = 200;

/** Returns the stream id, or `null` when `value` cannot be one. */
export function parseStreamId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STREAM_ID_LENGTH
    ? value
    : null;
}

/** Returns the number of chunks a window says it has, or `null` when it is not a count. */
export function parseKnownChunks(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
