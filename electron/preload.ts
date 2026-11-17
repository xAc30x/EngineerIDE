import { contextBridge } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';
import { aiApi } from './preload/ai';
import { fsApi } from './preload/fs';
import { secretsApi } from './preload/secrets';
import { stateApi } from './preload/state';
import { streamsApi } from './preload/streams';
import { threadsApi } from './preload/threads';
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
  ...secretsApi,
  ...stateApi,
  ...streamsApi,
  ...threadsApi,
  ...windowsApi,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
