import type { IpcResult, MessageRole } from '../../shared/types';

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
}

/** A message as stored. `position` is its index in the thread. */
export interface StoredMessage {
  id: string;
  threadId: string;
  position: number;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/** One change. The writer only ever adds or updates; nothing is deleted. */
export type StorageOp =
  | { kind: 'saveThread'; thread: StoredThread }
  | { kind: 'saveMessage'; message: StoredMessage };

export type StorageRequest =
  /** Opens (or creates) the database file and brings it up to date. */
  | { type: 'open'; filePath: string }
  /** Applies every op in one transaction: all of them, or none. */
  | { type: 'write'; ops: StorageOp[] }
  | { type: 'close' };

/** What each request returns when it succeeds. */
export interface StorageReplies {
  /** The schema version the database is at. */
  open: number;
  write: null;
  close: null;
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
  workerStopped: 'The storage worker stopped.',
} as const;
