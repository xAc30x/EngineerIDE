import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { AppStateStore } from '../appStateStore';
import type { ProjectFileAccess } from '../projectFiles';
import type { WindowRegistry } from '../windows';
import { StorageClient } from './client';
import { WINDOW_SETTING_KEYS } from './protocol';
import { buildRestoredState } from './restore';
import type { ThreadLoader } from './threadLoader';
import { loadStorage, startPersistence } from './writer';

/**
 * Starts storage (Phases 3b and 3c): the database worker, the database file
 * in the user data folder, restoring what was saved, and the writer. Called
 * once from `electron/main.ts`, before any window opens. No window opens the
 * database; everything goes through the worker.
 */

/** The database file, inside Electron's per-user data folder. */
export const DATABASE_FILE_NAME = 'engineeride.db';

// Built next to main.js in dist-electron/ (see vite.config.ts).
const WORKER_FILE_NAME = 'storage-worker.js';

// Longest the launch waits for the saved data before starting empty.
const LOAD_TIMEOUT_MS = 2000;

// Longest a quit waits for the last writes before closing anyway.
const QUIT_TIMEOUT_MS = 3000;

interface StorageDependencies {
  appState: AppStateStore;
  projectFiles: ProjectFileAccess;
  threadLoader: ThreadLoader;
  windows: WindowRegistry;
}

function warn(message: string): void {
  console.warn(`[storage] ${message} Changes are kept in memory only.`);
}

export async function startStorage({
  appState,
  projectFiles,
  threadLoader,
  windows,
}: StorageDependencies): Promise<void> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(app.getPath('userData'), DATABASE_FILE_NAME);

  let client: StorageClient;
  try {
    client = new StorageClient(new Worker(path.join(currentDir, WORKER_FILE_NAME)));
  } catch {
    warn('The storage worker could not start.');
    return;
  }

  // If the saved data cannot be read, start empty and write nothing, so the
  // file is never overwritten from an empty state.
  const loaded = await loadStorage(client, filePath, LOAD_TIMEOUT_MS);
  if (!loaded.ok) {
    warn(loaded.error);
    void client.close();
    return;
  }

  const restored = buildRestoredState(loaded.value);
  appState.restore(restored.state);
  // Restored threads read their messages through the same worker, so a read
  // always comes after the writes sent before it.
  threadLoader.attach(client);

  // The last project is used only if it is still a folder, approved the same
  // way as one picked in the dialog.
  if (restored.projectPath !== null) {
    const approved = await projectFiles.approveRoot(restored.projectPath);
    if (approved.ok) {
      appState.dispatch({ type: 'setActiveProject', folder: approved.value });
    }
  }

  const persistence = startPersistence(appState, client, restored.saved, warn);

  // Windows open at their last size and save each change (Phase 3c).
  const { settings } = loaded.value;
  windows.rememberBounds(
    {
      ...(settings.workspaceWindow === undefined ? {} : { workspace: settings.workspaceWindow }),
      ...(settings.ideWindow === undefined ? {} : { ide: settings.ideWindow }),
    },
    (kind, bounds) => persistence.saveSetting(WINDOW_SETTING_KEYS[kind], bounds),
  );

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
