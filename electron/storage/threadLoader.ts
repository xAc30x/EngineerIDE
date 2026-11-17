import type { SharedAction, SharedState } from '../../shared/appState';
import { findThread } from '../../shared/appState';
import type { IpcResult } from '../../shared/types';
import type { StoredMessage } from './protocol';
import { toMessages } from './restore';

/**
 * Loads a restored thread's messages from the database the first time main
 * needs them (Phase 3c): when a window opens the thread, and before anything
 * is added to it. No Electron imports, so it is unit-tested.
 */

/** The parts of `AppStateStore` the loader needs. */
export interface LoaderState {
  getSnapshot(): { state: SharedState };
  dispatch(action: SharedAction): void;
}

/** The part of `StorageClient` the loader needs. */
export interface MessageSource {
  request(request: { type: 'loadMessages'; threadId: string }): Promise<IpcResult<StoredMessage[]>>;
}

/** Fixed message: the database error is never passed on. */
export const THREAD_NOT_LOADED_ERROR = 'The earlier messages of this chat could not be loaded.';

export class ThreadLoader {
  private source: MessageSource | null = null;
  private readonly inFlight = new Map<string, Promise<IpcResult<null>>>();

  constructor(private readonly appState: LoaderState) {}

  /** Called by storage once the database is open and restored. */
  attach(source: MessageSource): void {
    this.source = source;
  }

  /**
   * Resolves once `threadId`'s messages are in the shared state. An unknown
   * thread or one already loaded needs nothing. Two calls for the same thread
   * share one read. After a failure the thread stays unloaded, so nothing can
   * be added to it, and a later call tries again.
   */
  ensureLoaded(threadId: string): Promise<IpcResult<null>> {
    const thread = findThread(this.appState.getSnapshot().state, threadId);
    if (thread === undefined || thread.messagesLoaded) {
      return Promise.resolve({ ok: true, value: null });
    }
    const running = this.inFlight.get(threadId);
    if (running !== undefined) {
      return running;
    }
    const load = this.load(threadId).finally(() => this.inFlight.delete(threadId));
    this.inFlight.set(threadId, load);
    return load;
  }

  private async load(threadId: string): Promise<IpcResult<null>> {
    if (this.source === null) {
      return { ok: false, error: THREAD_NOT_LOADED_ERROR };
    }
    let result: IpcResult<StoredMessage[]>;
    try {
      result = await this.source.request({ type: 'loadMessages', threadId });
    } catch {
      return { ok: false, error: THREAD_NOT_LOADED_ERROR };
    }
    if (!result.ok) {
      return { ok: false, error: THREAD_NOT_LOADED_ERROR };
    }
    this.appState.dispatch({
      type: 'loadThreadMessages',
      threadId,
      messages: toMessages(result.value),
    });
    return { ok: true, value: null };
  }
}
