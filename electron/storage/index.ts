import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { StorageClient } from './client';
import { startPersistence, type StateSource } from './writer';

/**
 * Starts storage (Phase 3b): the database worker, the database file in the
 * user data folder, and the writer. Called once from `electron/main.ts`.
 * No window opens the database; everything goes through the worker.
 */

/** The database file, inside Electron's per-user data folder. */
export const DATABASE_FILE_NAME = 'engineeride.db';

// Built next to main.js in dist-electron/ (see vite.config.ts).
const WORKER_FILE_NAME = 'storage-worker.js';

// Longest a quit waits for the last writes before closing anyway.
const QUIT_TIMEOUT_MS = 3000;

export function startStorage(appState: StateSource): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(app.getPath('userData'), DATABASE_FILE_NAME);

  let persistence;
  try {
    const worker = new Worker(path.join(currentDir, WORKER_FILE_NAME));
    persistence = startPersistence(appState, new StorageClient(worker), filePath, (error) => {
      console.warn(`[storage] ${error} Changes are kept in memory only.`);
    });
  } catch {
    console.warn('[storage] The storage worker could not start. Changes are kept in memory only.');
    return;
  }

  // Let the worker finish the writes already sent, then quit for real.
  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS));
    void Promise.race([persistence.close(), timeout])
      .catch(() => undefined)
      .finally(() => app.quit());
  });
}
