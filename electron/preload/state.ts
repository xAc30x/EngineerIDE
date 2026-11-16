import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { STATE_CHANNELS, type StateApi, type StateSnapshot } from '../../shared/ipc/state';

export const stateApi: StateApi = {
  getAppState: () => ipcRenderer.invoke(STATE_CHANNELS.get),
  dispatch: (action) => ipcRenderer.invoke(STATE_CHANNELS.dispatch, action),
  onStateChanged: (listener) => {
    // The IPC event object stays in the preload script; the page gets the snapshot only.
    const handler = (_event: IpcRendererEvent, snapshot: StateSnapshot) => listener(snapshot);
    ipcRenderer.on(STATE_CHANNELS.changed, handler);
    return () => {
      ipcRenderer.removeListener(STATE_CHANNELS.changed, handler);
    };
  },
};
