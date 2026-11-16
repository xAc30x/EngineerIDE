import { ipcRenderer } from 'electron';
import { WINDOW_CHANNELS, type WindowsApi } from '../../shared/ipc/windows';

export const windowsApi: WindowsApi = {
  showWindow: (kind) => ipcRenderer.invoke(WINDOW_CHANNELS.show, kind),
};
