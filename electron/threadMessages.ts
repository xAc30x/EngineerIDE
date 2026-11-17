import { findThread, type SharedState } from '../shared/appState';
import { THREADS_ERRORS } from '../shared/ipc/threads';
import type { IpcResult, Message } from '../shared/types';
import { THREAD_NOT_LOADED_ERROR, type ThreadLoader } from './storage/threadLoader';

/**
 * Answers `threads:getMessages` (Phase 3c). Electron-free, so it is
 * unit-tested; `electron/ipc/threads.ts` only wires it up.
 */

function isThreadId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= 200;
}

/** The messages main holds for `threadId`, without loading anything. */
export function readThreadMessages(state: SharedState, threadId: unknown): IpcResult<Message[]> {
  if (!isThreadId(threadId)) {
    return { ok: false, error: THREADS_ERRORS.invalidRequest };
  }
  const thread = findThread(state, threadId);
  if (thread === undefined) {
    return { ok: false, error: THREADS_ERRORS.unknownThread };
  }
  return thread.messagesLoaded
    ? { ok: true, value: thread.messages }
    : { ok: false, error: THREAD_NOT_LOADED_ERROR };
}

/** Loads the thread's messages from the database if needed, then returns them. */
export async function fetchThreadMessages(
  appState: { getSnapshot(): { state: SharedState } },
  loader: Pick<ThreadLoader, 'ensureLoaded'>,
  threadId: unknown,
): Promise<IpcResult<Message[]>> {
  if (!isThreadId(threadId)) {
    return { ok: false, error: THREADS_ERRORS.invalidRequest };
  }
  const loaded = await loader.ensureLoaded(threadId);
  if (!loaded.ok) {
    return loaded;
  }
  return readThreadMessages(appState.getSnapshot().state, threadId);
}
