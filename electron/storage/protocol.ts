import type { IpcResult, MessageRole, SectionKind } from '../../shared/types';

/**
 * The messages main and the storage worker exchange (Phase 3b). Main sends a
 * `WorkerRequest`; the worker answers each one with a `WorkerResponse` that
 * carries the same `id`. Everything here must survive structured cloning.
 */

/** A thread as stored: no messages, no running reply. */
export interface StoredThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The section it is in, or `null` for Recents (Phase 3c). */
  sectionId: string | null;
  /** Its index in that section or in Recents (Phase 3c). */
  position: number;
}

/** A section as stored, without its threads (Phase 3c). */
export interface StoredSection {
  id: string;
  title: string;
  kind: SectionKind;
  /** Its index in the sidebar. */
  position: number;
  isCollapsed: boolean;
}

/** Settings that mirror the shared state (Phase 3c). */
export const STATE_SETTING_KEYS = ['activeThreadId', 'activeProjectPath', 'selectedBackend'] as const;
export type StateSettingKey = (typeof STATE_SETTING_KEYS)[number];

/** Each window's size and position, as JSON (Phase 3c, `electron/windowBounds.ts`). */
export const WINDOW_SETTING_KEYS = { workspace: 'workspaceWindow', ide: 'ideWindow' } as const;

/** Every setting the app keeps between runs. Nothing else is accepted. */
export const SETTING_KEYS = [
  ...STATE_SETTING_KEYS,
  WINDOW_SETTING_KEYS.workspace,
  WINDOW_SETTING_KEYS.ide,
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** A message as stored. `position` is its index in the thread. */
export interface StoredMessage {
  id: string;
  threadId: string;
  position: number;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/**
 * One change. Threads and messages are only added or updated; a section is
 * deleted when the user removes it, and a setting set to `null` is cleared.
 */
export type StorageOp =
  | { kind: 'saveThread'; thread: StoredThread }
  | { kind: 'saveMessage'; message: StoredMessage }
  | { kind: 'saveSection'; section: StoredSection }
  | { kind: 'deleteSection'; id: string }
  | { kind: 'saveSetting'; key: SettingKey; value: string | null };

export type StorageRequest =
  /** Opens (or creates) the database file and brings it up to date. */
  | { type: 'open'; filePath: string }
  /** Applies every op in one transaction: all of them, or none. */
  | { type: 'write'; ops: StorageOp[] }
  /** Reads everything but message text, for restoring the app at launch (Phase 3c). */
  | { type: 'load' }
  /** Reads one thread's messages, when main first needs them (Phase 3c). */
  | { type: 'loadMessages'; threadId: string }
  | { type: 'close' };

/** What each request returns when it succeeds. */
export interface StorageReplies {
  /** The schema version the database is at. */
  open: number;
  write: null;
  load: StoredData;
  loadMessages: StoredMessage[];
  close: null;
}

/** A thread as read back at launch: with how many messages it has. */
export interface LoadedThread extends StoredThread {
  messageCount: number;
}

/**
 * What the app needs at launch (Phase 3c): everything but message text,
 * which is read per thread with `loadMessages`.
 */
export interface StoredData {
  /** In sidebar order. */
  sections: StoredSection[];
  /** By section, then position, then newest first. */
  threads: LoadedThread[];
  settings: Partial<Record<SettingKey, string>>;
}

export interface WorkerRequest {
  id: number;
  request: StorageRequest;
}

export interface WorkerResponse {
  id: number;
  result: IpcResult<unknown>;
}

/** Fixed error messages: SQLite's own text is never passed on. */
export const STORAGE_ERRORS = {
  invalidRequest: 'The storage request was not valid.',
  alreadyOpen: 'The database is already open.',
  notOpen: 'The database is not open.',
  openFailed: 'The database could not be opened.',
  writeFailed: 'The change could not be saved.',
  loadFailed: 'The saved data could not be read.',
  loadTimedOut: 'Reading the saved data took too long.',
  workerStopped: 'The storage worker stopped.',
} as const;
