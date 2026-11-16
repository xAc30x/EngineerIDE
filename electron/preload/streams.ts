import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { STREAM_CHANNELS, type StreamDelta, type StreamsApi } from '../../shared/ipc/streams';

export const streamsApi: StreamsApi = {
  onStreamData: (listener) => {
    // The IPC event object stays in the preload script; the page gets the delta only.
    const handler = (_event: IpcRendererEvent, delta: StreamDelta) => listener(delta);
    ipcRenderer.on(STREAM_CHANNELS.data, handler);
    return () => {
      ipcRenderer.removeListener(STREAM_CHANNELS.data, handler);
    };
  },
  subscribeStream: (streamId, knownChunks) =>
    ipcRenderer.invoke(STREAM_CHANNELS.subscribe, streamId, knownChunks),
  unsubscribeStream: (streamId) => ipcRenderer.invoke(STREAM_CHANNELS.unsubscribe, streamId),
  cancelStream: (streamId) => ipcRenderer.invoke(STREAM_CHANNELS.cancel, streamId),
  startTestStream: (options) => ipcRenderer.invoke(STREAM_CHANNELS.startTest, options),
};
