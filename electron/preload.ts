import { contextBridge } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';
import { aiApi } from './preload/ai';
import { fsApi } from './preload/fs';
import { stateApi } from './preload/state';
import { streamsApi } from './preload/streams';
import { windowsApi } from './preload/windows';

/**
 * The only surface a window can use to reach the operating system and the
 * main process. Each IPC domain contributes its methods from
 * `electron/preload/<domain>.ts`; `ipcRenderer` itself is never exposed.
 */
const electronAPI: ElectronAPI = {
  platform: process.platform,
  ...aiApi,
  ...fsApi,
  ...stateApi,
  ...streamsApi,
  ...windowsApi,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
