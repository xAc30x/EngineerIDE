import type { BackendProvider, IpcResult } from '../types';

export const SECRETS_CHANNELS = {
  setApiKey: 'secrets:setApiKey',
  clearApiKey: 'secrets:clearApiKey',
  listApiKeys: 'secrets:listApiKeys',
} as const;

/** Backends that are reached with an API key. */
export type ApiKeyProvider = Exclude<BackendProvider, 'claude-cli'>;

export const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = ['anthropic-api', 'openai-api', 'openrouter'];

export function isApiKeyProvider(value: unknown): value is ApiKeyProvider {
  return typeof value === 'string' && (API_KEY_PROVIDERS as readonly string[]).includes(value);
}

/** Longest key accepted, in characters. Real keys are far shorter. */
export const MAX_API_KEY_LENGTH = 512;

/**
 * Whether a backend has a key saved. This is everything a window ever learns
 * about a key: the key itself never leaves the main process.
 */
export interface ApiKeyStatus {
  id: ApiKeyProvider;
  isSet: boolean;
}

export interface SecretsApi {
  /** Encrypts and saves the key for `provider`, replacing any saved one. */
  setApiKey(provider: ApiKeyProvider, key: string): Promise<IpcResult<null>>;
  /** Deletes the saved key for `provider`. */
  clearApiKey(provider: ApiKeyProvider): Promise<IpcResult<null>>;
  /** Which backends have a key saved. */
  listApiKeys(): Promise<IpcResult<ApiKeyStatus[]>>;
}
