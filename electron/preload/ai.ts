import { ipcRenderer } from 'electron';
import { AI_CHANNELS, type AiApi } from '../../shared/ipc/ai';

export const aiApi: AiApi = {
  sendChatMessage: (threadId, content) => ipcRenderer.invoke(AI_CHANNELS.sendMessage, threadId, content),
  cancelReply: (threadId) => ipcRenderer.invoke(AI_CHANNELS.cancelReply, threadId),
  listProviders: () => ipcRenderer.invoke(AI_CHANNELS.listProviders),
};
