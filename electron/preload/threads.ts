import { ipcRenderer } from 'electron';
import { THREADS_CHANNELS, type ThreadsApi } from '../../shared/ipc/threads';

export const threadsApi: ThreadsApi = {
  getThreadMessages: (threadId) => ipcRenderer.invoke(THREADS_CHANNELS.getMessages, threadId),
};
