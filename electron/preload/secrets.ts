import { ipcRenderer } from 'electron';
import { SECRETS_CHANNELS, type SecretsApi } from '../../shared/ipc/secrets';

export const secretsApi: SecretsApi = {
  setApiKey: (provider, key) => ipcRenderer.invoke(SECRETS_CHANNELS.setApiKey, provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke(SECRETS_CHANNELS.clearApiKey, provider),
  listApiKeys: () => ipcRenderer.invoke(SECRETS_CHANNELS.listApiKeys),
};
