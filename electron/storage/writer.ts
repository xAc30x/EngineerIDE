import { findThread, type SharedState } from '../../shared/appState';
import type { IpcResult, Thread } from '../../shared/types';
import type { StorageOp } from './protocol';

/**
 * The one writer (Phase 3b): turns each change to the shared state into the
 * storage ops that save it. Pure, so it is unit-tested without a database.
 *
 * Write-only by design. 3b never loads data back, so a thread missing from
 * memory is not a reason to delete it from the file: it may be from an earlier
 * session. Sections are not stored until 3c, and a running reply is stored
 * only once it finishes, as messages.
 */

function allThreads(state: SharedState): Thread[] {
  return [...state.sections.flatMap((section) => section.items), ...state.recents];
}

/** Ops that save what changed from `previous` to `next`, threads first. */
export function storageOpsForChange(previous: SharedState, next: SharedState): StorageOp[] {
  const ops: StorageOp[] = [];
  for (const thread of allThreads(next)) {
    // An empty thread is not saved: the app reuses or drops it freely.
    if (thread.messages.length === 0) continue;

    const before = findThread(previous, thread.id);
    const savedBefore = before !== undefined && before.messages.length > 0;
    if (!savedBefore || before.title !== thread.title || before.updatedAt !== thread.updatedAt) {
      const { id, title, createdAt, updatedAt } = thread;
      ops.push({ kind: 'saveThread', thread: { id, title, createdAt, updatedAt } });
    }

    const knownIds = new Set(before?.messages.map((message) => message.id));
    thread.messages.forEach((message, position) => {
      if (knownIds.has(message.id)) return;
      ops.push({
        kind: 'saveMessage',
        message: {
          id: message.id,
          threadId: thread.id,
          position,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        },
      });
    });
  }
  return ops;
}

/** The parts of `AppStateStore` the writer needs. */
export interface StateSource {
  getSnapshot(): { state: SharedState };
  subscribe(listener: (snapshot: { state: SharedState }) => void): () => void;
}

/** The parts of `StorageClient` the writer needs. */
export interface StorageSink {
  request(request: { type: 'open'; filePath: string }): Promise<IpcResult<number>>;
  request(request: { type: 'write'; ops: StorageOp[] }): Promise<IpcResult<null>>;
  close(): Promise<void>;
}

export interface Persistence {
  /** Sends nothing more, waits for every write already sent, and closes. */
  close(): Promise<void>;
}

/**
 * Opens the database and saves every later state change, in order. Writes
 * are sent without waiting: the worker runs them in the order they arrive.
 * A failure is reported once through `onError` (a fixed message) and the app
 * carries on in memory; after a failed open nothing more is sent.
 */
export function startPersistence(
  source: StateSource,
  sink: StorageSink,
  filePath: string,
  onError: (error: string) => void,
): Persistence {
  let previous = source.getSnapshot().state;
  let enabled = true;
  let reported = false;
  const report = (error: string) => {
    if (reported) return;
    reported = true;
    onError(error);
  };

  void sink.request({ type: 'open', filePath }).then((result) => {
    if (!result.ok) {
      enabled = false;
      report(result.error);
    }
  });

  const unsubscribe = source.subscribe(({ state }) => {
    const ops = storageOpsForChange(previous, state);
    previous = state;
    if (!enabled || ops.length === 0) return;
    void sink.request({ type: 'write', ops }).then((result) => {
      if (!result.ok) report(result.error);
    });
  });

  return {
    close: async () => {
      unsubscribe();
      enabled = false;
      await sink.close();
    },
  };
}
