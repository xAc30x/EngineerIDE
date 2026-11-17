import { ipcRenderer } from 'electron';
import { FS_CHANNELS, type FsApi } from '../../shared/ipc/fs';

export const fsApi: FsApi = {
  selectFolder: () => ipcRenderer.invoke(FS_CHANNELS.selectFolder),
  readDir: (dirPath) => ipcRenderer.invoke(FS_CHANNELS.readDir, dirPath),
  readFile: (filePath) => ipcRenderer.invoke(FS_CHANNELS.readFile, filePath),
  writeFile: (filePath, content, expectedMtimeMs) =>
    ipcRenderer.invoke(FS_CHANNELS.writeFile, filePath, content, expectedMtimeMs),
};
