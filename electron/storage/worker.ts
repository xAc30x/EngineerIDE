import { DatabaseSync } from 'node:sqlite';
import { parentPort } from 'node:worker_threads';
import { createStorageHandler } from './handler';
import { STORAGE_ERRORS, type WorkerResponse } from './protocol';

/**
 * Entry point of the storage worker thread (Phase 3b). Every SQLite query in
 * the app runs here, so a slow query never blocks main or its IPC. Requests
 * are handled one at a time, in the order main sent them.
 */

const port = parentPort;
if (port === null) {
  throw new Error('The storage worker must run in a worker thread.');
}

const handle = createStorageHandler((filePath) => new DatabaseSync(filePath));

port.on('message', (message: unknown) => {
  if (typeof message !== 'object' || message === null) {
    return;
  }
  const { id, request } = message as { id?: unknown; request?: unknown };
  if (typeof id !== 'number') {
    return;
  }
  let response: WorkerResponse;
  try {
    response = { id, result: handle(request) };
  } catch {
    response = { id, result: { ok: false, error: STORAGE_ERRORS.writeFailed } };
  }
  port.postMessage(response);
});
