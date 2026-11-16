import { MAX_MESSAGE_LENGTH } from '../../shared/ipc/ai';

const MAX_THREAD_ID_LENGTH = 200;

/** A thread id from a window: a short non-empty string, or `null` when allowed. */
export function parseThreadId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_THREAD_ID_LENGTH
    ? value
    : undefined;
}

/** A message from a window, or `undefined` when it is not a string or is too long. */
export function parseMessageContent(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_MESSAGE_LENGTH ? value : undefined;
}
