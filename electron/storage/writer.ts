import type { SharedState } from '../../shared/appState';
import type { IpcResult, Thread } from '../../shared/types';
import {
  STORAGE_ERRORS,
  type SettingKey,
  type StateSettingKey,
  type StorageOp,
  type StoredData,
  type StoredSection,
} from './protocol';

/**
 * The one writer (Phases 3b and 3c): turns each change to the shared state
 * into the storage ops that save it. Pure, so it is unit-tested without a
 * database.
 *
 * Threads and messages are only added or updated, never deleted (the app has
 * no way to delete them yet). A removed section is deleted. Empty threads are
 * not saved, and a running reply is saved only once it finishes, as messages.
 */

interface PlacedThread {
  thread: Thread;
  sectionId: string | null;
  position: number;
}

/** Every thread with the section it is in (`null` for Recents) and its index there. */
function placedThreads(state: SharedState): Map<string, PlacedThread> {
  const placed = new Map<string, PlacedThread>();
  for (const section of state.sections) {
    section.items.forEach((thread, position) => {
      placed.set(thread.id, { thread, sectionId: section.id, position });
    });
  }
  state.recents.forEach((thread, position) => {
    placed.set(thread.id, { thread, sectionId: null, position });
  });
  return placed;
}

function storedSections(state: SharedState): Map<string, StoredSection> {
  return new Map(
    state.sections.map((section, position) => [
      section.id,
      {
        id: section.id,
        title: section.title,
        kind: section.kind,
        position,
        isCollapsed: section.isCollapsed,
      },
    ]),
  );
}

function sameSection(a: StoredSection, b: StoredSection): boolean {
  return (
    a.title === b.title &&
    a.kind === b.kind &&
    a.position === b.position &&
    a.isCollapsed === b.isCollapsed
  );
}

/** The settings kept between runs, read from the state. */
export function settingsOf(state: SharedState): Record<StateSettingKey, string | null> {
  return {
    activeThreadId: state.activeThreadId,
    activeProjectPath: state.activeProjectPath,
    selectedBackend: state.selectedBackend,
  };
}

/**
 * Ops that save what changed from `previous` to `next`: sections first, then
 * threads and their new messages, then settings, then removed sections.
 */
export function storageOpsForChange(previous: SharedState, next: SharedState): StorageOp[] {
  const ops: StorageOp[] = [];

  const sectionsBefore = storedSections(previous);
  const sectionsAfter = storedSections(next);
  for (const section of sectionsAfter.values()) {
    const before = sectionsBefore.get(section.id);
    if (before === undefined || !sameSection(before, section)) {
      ops.push({ kind: 'saveSection', section });
    }
  }

  const threadsBefore = placedThreads(previous);
  for (const { thread, sectionId, position } of placedThreads(next).values()) {
    // An empty thread is not saved: the app reuses or drops it freely.
    if (thread.messageCount === 0) continue;

    const before = threadsBefore.get(thread.id);
    const savedBefore = before !== undefined && before.thread.messageCount > 0;
    if (
      !savedBefore ||
      before.thread.title !== thread.title ||
      before.thread.updatedAt !== thread.updatedAt ||
      before.sectionId !== sectionId ||
      before.position !== position
    ) {
      const { id, title, createdAt, updatedAt } = thread;
      ops.push({
        kind: 'saveThread',
        thread: { id, title, createdAt, updatedAt, sectionId, position },
      });
    }

    // Messages just read from the database (a thread that was not loaded
    // before) are already saved.
    const knownIds = new Set(
      (before?.thread.messagesLoaded === false ? thread : before?.thread)?.messages.map(
        (message) => message.id,
      ),
    );
    thread.messages.forEach((message, index) => {
      if (knownIds.has(message.id)) return;
      ops.push({
        kind: 'saveMessage',
        message: {
          id: message.id,
          threadId: thread.id,
          position: index,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        },
      });
    });
  }

  const settingsBefore = settingsOf(previous);
  const settingsAfter = settingsOf(next);
  for (const key of Object.keys(settingsAfter) as StateSettingKey[]) {
    if (settingsBefore[key] !== settingsAfter[key]) {
      ops.push({ kind: 'saveSetting', key, value: settingsAfter[key] });
    }
  }

  for (const id of sectionsBefore.keys()) {
    if (!sectionsAfter.has(id)) {
      ops.push({ kind: 'deleteSection', id });
    }
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
  request(request: { type: 'load' }): Promise<IpcResult<StoredData>>;
  request(request: { type: 'write'; ops: StorageOp[] }): Promise<IpcResult<null>>;
  close(): Promise<void>;
}

/**
 * Opens the database and reads everything in it (Phase 3c). Gives up after
 * `timeoutMs`, so a stuck worker cannot hold up the launch.
 */
export async function loadStorage(
  sink: StorageSink,
  filePath: string,
  timeoutMs: number,
): Promise<IpcResult<StoredData>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<IpcResult<StoredData>>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: STORAGE_ERRORS.loadTimedOut }),
      timeoutMs,
    );
  });
  const read = (async (): Promise<IpcResult<StoredData>> => {
    const opened = await sink.request({ type: 'open', filePath });
    if (!opened.ok) return opened;
    return sink.request({ type: 'load' });
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Persistence {
  /**
   * Saves a setting that is not part of the shared state (a window's size),
   * in order with the other writes.
   */
  saveSetting(key: SettingKey, value: string | null): void;
  /** Sends nothing more, waits for every write already sent, and closes. */
  close(): Promise<void>;
}

/**
 * Saves every change to the state, in order, starting from `saved`: the state
 * as it already is in the database. Whatever differs from it right now (for
 * example the built-in sections of a new database) is written first. Writes
 * are sent without waiting: the worker runs them in the order they arrive. A
 * failure is reported once through `onError` (a fixed message) and the app
 * carries on in memory.
 */
export function startPersistence(
  source: StateSource,
  sink: StorageSink,
  saved: SharedState,
  onError: (error: string) => void,
): Persistence {
  let previous = saved;
  let enabled = true;
  let reported = false;
  const report = (error: string) => {
    if (reported) return;
    reported = true;
    onError(error);
  };

  const write = (ops: StorageOp[]) => {
    if (!enabled || ops.length === 0) return;
    void sink.request({ type: 'write', ops }).then((result) => {
      if (!result.ok) report(result.error);
    });
  };
  const save = (state: SharedState) => {
    const ops = storageOpsForChange(previous, state);
    previous = state;
    write(ops);
  };

  save(source.getSnapshot().state);
  const unsubscribe = source.subscribe(({ state }) => save(state));

  return {
    saveSetting: (key, value) => write([{ kind: 'saveSetting', key, value }]),
    close: async () => {
      unsubscribe();
      enabled = false;
      await sink.close();
    },
  };
}
