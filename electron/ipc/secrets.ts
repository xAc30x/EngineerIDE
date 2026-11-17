import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SECRETS_CHANNELS, type ApiKeyStatus } from '../../shared/ipc/secrets';
import { KeyStore, type KeyCipher, type KeyFile } from '../secrets/keyStore';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface SecretsIpcDependencies {
  windows: WindowRegistry;
}

/**
 * Electron `safeStorage`, refusing the weak fallback. On Linux without a
 * keyring Electron would "encrypt" with a fixed password (`basic_text`), which
 * is no protection, so saving is refused instead.
 */
const safeStorageCipher: KeyCipher = {
  async isAvailable() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      return false;
    }
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend();
      return backend !== 'basic_text' && backend !== 'unknown';
    }
    return true;
  },
  encrypt: async (plainText) => safeStorage.encryptStringAsync(plainText),
  decrypt: async (encrypted) => (await safeStorage.decryptStringAsync(Buffer.from(encrypted))).result,
};

/** The encrypted keys file in the app's user data folder, readable only by the user. */
function userDataKeyFile(): KeyFile {
  const filePath = path.join(app.getPath('userData'), 'api-keys.json');
  return {
    async read() {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async write(text) {
      // Write a temporary file, then rename, so a crash never leaves half a file.
      const temporaryPath = `${filePath}.tmp`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(temporaryPath, text, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporaryPath, filePath);
    },
  };
}

/**
 * Registers the `secrets:*` handlers and returns the key store for the AI
 * providers. There is deliberately no handler that returns a key.
 */
export function registerSecretsIpc({ windows }: SecretsIpcDependencies): KeyStore {
  const keys = new KeyStore(safeStorageCipher, userDataKeyFile());

  handleFromAppWindow<null>(SECRETS_CHANNELS.setApiKey, windows, (_event, provider, key) =>
    keys.setKey(provider, key),
  );

  handleFromAppWindow<null>(SECRETS_CHANNELS.clearApiKey, windows, (_event, provider) => keys.clearKey(provider));

  handleFromAppWindow<ApiKeyStatus[]>(SECRETS_CHANNELS.listApiKeys, windows, async () => ({
    ok: true,
    value: await keys.listStatus(),
  }));

  return keys;
}
