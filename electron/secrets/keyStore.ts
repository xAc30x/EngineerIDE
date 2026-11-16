import {
  API_KEY_PROVIDERS,
  MAX_API_KEY_LENGTH,
  isApiKeyProvider,
  type ApiKeyProvider,
  type ApiKeyStatus,
} from '../../shared/ipc/secrets';
import type { IpcResult } from '../../shared/types';

/**
 * Encrypts keys with the operating system's keychain. In the app this is
 * Electron `safeStorage` (see `electron/ipc/secrets.ts`); tests use a fake.
 */
export interface KeyCipher {
  /** Whether strong, keychain-backed encryption can be used now. */
  isAvailable(): Promise<boolean>;
  encrypt(plainText: string): Promise<Uint8Array>;
  decrypt(encrypted: Uint8Array): Promise<string>;
}

/** Where the encrypted keys are kept. In the app, one file in the user data folder. */
export interface KeyFile {
  /** The file's text, or `null` when there is no file yet. */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

// Fixed messages. None of them may ever include the key.
export const KEYCHAIN_UNAVAILABLE_ERROR =
  'API keys cannot be saved: no system keychain is available to encrypt them. ' +
  'On Linux, install and unlock a keyring such as GNOME Keyring or KWallet, then restart the app.';
export const INVALID_KEY_ERROR = 'That does not look like an API key. Paste the key without spaces or line breaks.';
export const INVALID_PROVIDER_ERROR = 'Request rejected: unknown API key provider.';
export const SAVE_FAILED_ERROR = 'The API key could not be saved.';

interface KeyFileContent {
  version: 1;
  /** Base64 of each provider's encrypted key. */
  keys: Partial<Record<ApiKeyProvider, string>>;
}

/** Printable ASCII with no spaces: every real API key looks like this. */
const KEY_PATTERN = /^[\x21-\x7e]+$/;

/** The trimmed key when `value` looks like an API key, otherwise `undefined`. */
export function parseApiKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const key = value.trim();
  if (key.length === 0 || key.length > MAX_API_KEY_LENGTH || !KEY_PATTERN.test(key)) {
    return undefined;
  }
  return key;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/**
 * Saves API keys encrypted, one per provider. Only the main process holds the
 * decrypted key, and only while a request needs it. No Electron imports, so it
 * can be unit-tested.
 */
export class KeyStore {
  /** Serialises writes so two saves cannot overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly cipher: KeyCipher,
    private readonly file: KeyFile,
  ) {}

  /** Encrypts and saves `keyValue` for `providerValue`. Both arrive unvalidated. */
  setKey(providerValue: unknown, keyValue: unknown): Promise<IpcResult<null>> {
    if (!isApiKeyProvider(providerValue)) {
      return Promise.resolve({ ok: false, error: INVALID_PROVIDER_ERROR });
    }
    const key = parseApiKey(keyValue);
    if (key === undefined) {
      return Promise.resolve({ ok: false, error: INVALID_KEY_ERROR });
    }
    return this.update(async (content) => {
      if (!(await this.cipher.isAvailable())) {
        return { ok: false, error: KEYCHAIN_UNAVAILABLE_ERROR };
      }
      content.keys[providerValue] = toBase64(await this.cipher.encrypt(key));
      return { ok: true, value: null };
    });
  }

  /** Deletes the saved key for `providerValue`. */
  clearKey(providerValue: unknown): Promise<IpcResult<null>> {
    if (!isApiKeyProvider(providerValue)) {
      return Promise.resolve({ ok: false, error: INVALID_PROVIDER_ERROR });
    }
    return this.update(async (content) => {
      delete content.keys[providerValue];
      return { ok: true, value: null };
    });
  }

  /** Which providers have a key saved. Never decrypts anything. */
  async listStatus(): Promise<ApiKeyStatus[]> {
    const content = await this.load();
    return API_KEY_PROVIDERS.map((id) => ({ id, isSet: content.keys[id] !== undefined }));
  }

  /** Whether `provider` has a key saved. */
  async hasKey(provider: ApiKeyProvider): Promise<boolean> {
    return (await this.load()).keys[provider] !== undefined;
  }

  /**
   * The decrypted key, for a provider about to make a request; `null` when
   * none is saved or it cannot be decrypted. Main process only: never send
   * the result to a window, a log, or an error message.
   */
  async getKey(provider: ApiKeyProvider): Promise<string | null> {
    const encrypted = (await this.load()).keys[provider];
    if (encrypted === undefined) {
      return null;
    }
    try {
      return await this.cipher.decrypt(fromBase64(encrypted));
    } catch {
      return null;
    }
  }

  private async load(): Promise<KeyFileContent> {
    await this.queue.catch(() => undefined);
    try {
      return this.parse(await this.file.read());
    } catch {
      return { version: 1, keys: {} };
    }
  }

  /** The file's content. A missing file has no keys; a corrupt one is treated the same. */
  private parse(text: string | null): KeyFileContent {
    if (text === null) {
      return { version: 1, keys: {} };
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const keys: KeyFileContent['keys'] = {};
      if (typeof parsed === 'object' && parsed !== null && 'keys' in parsed) {
        const stored = (parsed as { keys: unknown }).keys;
        if (typeof stored === 'object' && stored !== null) {
          for (const [id, value] of Object.entries(stored)) {
            if (isApiKeyProvider(id) && typeof value === 'string') {
              keys[id] = value;
            }
          }
        }
      }
      return { version: 1, keys };
    } catch {
      return { version: 1, keys: {} };
    }
  }

  /** Runs `change` on the current file content and writes it if it succeeded. */
  private update(change: (content: KeyFileContent) => Promise<IpcResult<null>>): Promise<IpcResult<null>> {
    const run = this.queue
      .catch(() => undefined)
      .then(async (): Promise<IpcResult<null>> => {
        try {
          // A read that fails (rather than finding no file) fails the save, so
          // a passing error can never overwrite the other providers' keys.
          const content = this.parse(await this.file.read());
          const result = await change(content);
          if (result.ok) {
            await this.file.write(JSON.stringify(content));
          }
          return result;
        } catch {
          // Never pass on the underlying error: it could quote what was being saved.
          return { ok: false, error: SAVE_FAILED_ERROR };
        }
      });
    this.queue = run;
    return run;
  }
}
