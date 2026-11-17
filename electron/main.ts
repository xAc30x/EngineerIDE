import { app, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppStateStore } from './appStateStore';
import { registerAiIpc } from './ipc/ai';
import { registerFsIpc } from './ipc/fs';
import { registerSecretsIpc } from './ipc/secrets';
import { registerStateIpc } from './ipc/state';
import { registerStreamsIpc } from './ipc/streams';
import { registerThreadsIpc } from './ipc/threads';
import { registerWindowsIpc } from './ipc/windows';
import { ProjectFileAccess } from './projectFiles';
import { startStorage } from './storage';
import { ThreadLoader } from './storage/threadLoader';
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
const threadLoader = new ThreadLoader(appState);

app.on('window-all-closed', () => app.quit());

app
  .whenReady()
  .then(async () => {
    // One line per IPC domain; handlers live in electron/ipc/<domain>.ts.
    registerFsIpc({ windows, projectFiles, appState });
    registerStateIpc({ windows, appState, threadLoader });
    const streams = registerStreamsIpc({ windows });
    const secrets = registerSecretsIpc({ windows });
    registerAiIpc({ windows, appState, streams, secrets, threadLoader });
    registerWindowsIpc({ windows });
    registerThreadsIpc({ windows, appState, threadLoader });
    // Restores saved threads before any window asks for the state.
    await startStorage({ appState, projectFiles, threadLoader, windows });
    windows.show('workspace');
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('EngineerIDE failed to start', detail);
    app.quit();
  });
