import { ipcRenderer } from 'electron';
import { FS_CHANNELS, type FsApi } from '../../shared/ipc/fs';

export const fsApi: FsApi = {
  selectFolder: () => ipcRenderer.invoke(FS_CHANNELS.selectFolder),
  readDir: (dirPath) => ipcRenderer.invoke(FS_CHANNELS.readDir, dirPath),
};
