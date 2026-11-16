import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../src/types';
import { IPC_CHANNELS } from './channels';

/**
 * The only surface the renderer can use to reach the operating system.
 * Each method maps to exactly one IPC channel; `ipcRenderer` itself is never
 * exposed.
 */
const electronAPI: ElectronAPI = {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectFolder),
  readDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.readDir, dirPath),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
