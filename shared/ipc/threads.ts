import type { IpcResult, Message } from '../types';

/**
 * Messages of one thread, fetched on demand (Phase 3c). The state snapshot
 * carries only a thread index, so a window asks for the messages of the
 * thread it shows, and again whenever that thread's `messageCount` changes.
 */
export const THREADS_CHANNELS = {
  getMessages: 'threads:getMessages',
} as const;

export interface ThreadsApi {
  /** The thread's messages, oldest first. Fails for an unknown thread. */
  getThreadMessages(threadId: string): Promise<IpcResult<Message[]>>;
}

/** Fixed error messages for the `threads:*` channels. */
export const THREADS_ERRORS = {
  invalidRequest: 'Request rejected: it is not a valid thread id.',
  unknownThread: 'That conversation no longer exists.',
} as const;
