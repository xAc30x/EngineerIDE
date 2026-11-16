import { app, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppStateStore } from './appStateStore';
import { registerFsIpc } from './ipc/fs';
import { registerStateIpc } from './ipc/state';
import { registerWindowsIpc } from './ipc/windows';
import { ProjectFileAccess } from './projectFiles';
import { WindowRegistry } from './windows';

// This file is bundled to dist-electron/main.js, next to preload.cjs.
const currentDir = path.dirname(fileURLToPath(import.meta.url));

const windows = new WindowRegistry({
  preloadPath: path.join(currentDir, 'preload.cjs'),
  rendererIndexPath: path.join(currentDir, '..', 'dist', 'index.html'),
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
});
const appState = new AppStateStore();
const projectFiles = new ProjectFileAccess();

app.on('window-all-closed', () => app.quit());

app
  .whenReady()
  .then(() => {
    // One line per IPC domain; handlers live in electron/ipc/<domain>.ts.
    registerFsIpc({ windows, projectFiles, appState });
    registerStateIpc({ windows, appState });
    registerWindowsIpc({ windows });
    windows.show('workspace');
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('EngineerIDE failed to start', detail);
    app.quit();
  });
