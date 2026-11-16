import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileNode, IpcResult, SelectedFolder } from '../src/types';
import { IPC_CHANNELS } from './channels';
import { ProjectFileAccess } from './projectFiles';

// This file is bundled to dist-electron/main.js, next to preload.cjs.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(currentDir, 'preload.cjs');
const RENDERER_INDEX_PATH = path.join(currentDir, '..', 'dist', 'index.html');

/** Set by vite-plugin-electron while `npm run dev` is running. */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const WINDOW_BACKGROUND_COLOR = '#1c1c1f';
const UNTRUSTED_SENDER_ERROR = 'Request rejected: it did not come from the application window.';

const projectFiles = new ProjectFileAccess();
let mainWindow: BrowserWindow | null = null;

/** In development only the dev server origin may be navigated to; in production nothing may. */
function isAllowedNavigation(targetUrl: string): boolean {
  if (DEV_SERVER_URL === undefined) {
    return false;
  }
  try {
    return new URL(targetUrl).origin === new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'EngineerIDE',
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // The app never opens extra windows and never leaves its own page.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) {
      event.preventDefault();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const loading =
    DEV_SERVER_URL !== undefined
      ? window.loadURL(DEV_SERVER_URL)
      : window.loadFile(RENDERER_INDEX_PATH);
  loading.catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('EngineerIDE could not load its interface', detail);
  });

  return window;
}

/** IPC requests are accepted only from the main application window. */
function isFromMainWindow(event: IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.selectFolder,
    async (event): Promise<IpcResult<SelectedFolder | null>> => {
      if (mainWindow === null || !isFromMainWindow(event)) {
        return { ok: false, error: UNTRUSTED_SENDER_ERROR };
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select project folder',
        properties: ['openDirectory'],
      });
      const selectedPath = result.filePaths[0];
      if (result.canceled || selectedPath === undefined) {
        return { ok: true, value: null };
      }
      return projectFiles.approveRoot(selectedPath);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.readDir,
    async (event, dirPath: unknown): Promise<IpcResult<FileNode[]>> => {
      if (!isFromMainWindow(event)) {
        return { ok: false, error: UNTRUSTED_SENDER_ERROR };
      }
      return projectFiles.readDir(dirPath);
    },
  );
}

app.on('window-all-closed', () => {
  // macOS apps conventionally stay open until the user quits explicitly.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app
  .whenReady()
  .then(() => {
    registerIpcHandlers();
    mainWindow = createMainWindow();
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('EngineerIDE failed to start', detail);
    app.quit();
  });
