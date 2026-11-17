import { describe, expect, it } from 'vitest';
import {
  INVALID_KEY_ERROR,
  INVALID_PROVIDER_ERROR,
  KEYCHAIN_UNAVAILABLE_ERROR,
  KeyStore,
  SAVE_FAILED_ERROR,
  parseApiKey,
  type KeyCipher,
  type KeyFile,
} from '../electron/secrets/keyStore';

// An obviously fake key. No real key is ever used in tests.
const FAKE_KEY = 'fake-test-key-0123456789';

/** Reversible stand-in for safeStorage: reverses the bytes so the file never holds the plain key. */
function fakeCipher(available = true): KeyCipher {
  return {
    isAvailable: async () => available,
    encrypt: async (text) => new TextEncoder().encode(text).reverse(),
    decrypt: async (bytes) => new TextDecoder().decode(new Uint8Array(bytes).reverse()),
  };
}

function memoryFile(): KeyFile & { text: string | null } {
  const file = {
    text: null as string | null,
    read: async () => file.text,
    write: async (text: string) => {
      file.text = text;
    },
  };
  return file;
}

describe('parseApiKey', () => {
  it('accepts a key and trims surrounding whitespace', () => {
    expect(parseApiKey(`  ${FAKE_KEY}\n`)).toBe(FAKE_KEY);
  });

  it.each([undefined, null, 42, '', '   ', 'has space inside', 'line\nbreak', 'x'.repeat(513), 'ключ'])(
    'rejects %j',
    (value) => {
      expect(parseApiKey(value)).toBeUndefined();
    },
  );
});

describe('KeyStore', () => {
  it('saves a key encrypted and returns it decrypted', async () => {
    const file = memoryFile();
    const store = new KeyStore(fakeCipher(), file);
    expect(await store.setKey('openai-api', FAKE_KEY)).toEqual({ ok: true, value: null });
    expect(file.text).not.toContain(FAKE_KEY);
    expect(await store.getKey('openai-api')).toBe(FAKE_KEY);
    expect(await store.getKey('anthropic-api')).toBeNull();
  });

  it('keeps keys across a restart (a new store reading the same file)', async () => {
    const file = memoryFile();
    await new KeyStore(fakeCipher(), file).setKey('openrouter', FAKE_KEY);
    const restarted = new KeyStore(fakeCipher(), file);
    expect(await restarted.getKey('openrouter')).toBe(FAKE_KEY);
    expect(await restarted.hasKey('openrouter')).toBe(true);
  });

  it('lists only whether each key is set', async () => {
    const store = new KeyStore(fakeCipher(), memoryFile());
    await store.setKey('anthropic-api', FAKE_KEY);
    const status = await store.listStatus();
    expect(status).toEqual([
      { id: 'anthropic-api', isSet: true },
      { id: 'openai-api', isSet: false },
      { id: 'openrouter', isSet: false },
    ]);
    expect(JSON.stringify(status)).not.toContain(FAKE_KEY);
  });

  it('clears a key', async () => {
    const store = new KeyStore(fakeCipher(), memoryFile());
    await store.setKey('openai-api', FAKE_KEY);
    expect(await store.clearKey('openai-api')).toEqual({ ok: true, value: null });
    expect(await store.getKey('openai-api')).toBeNull();
  });

  it('refuses to save when no keychain is available, and writes nothing', async () => {
    const file = memoryFile();
    const store = new KeyStore(fakeCipher(false), file);
    expect(await store.setKey('openai-api', FAKE_KEY)).toEqual({ ok: false, error: KEYCHAIN_UNAVAILABLE_ERROR });
    expect(file.text).toBeNull();
  });

  it('rejects an unknown provider and a malformed key without echoing the input', async () => {
    const store = new KeyStore(fakeCipher(), memoryFile());
    expect(await store.setKey('claude-cli', FAKE_KEY)).toEqual({ ok: false, error: INVALID_PROVIDER_ERROR });
    expect(await store.setKey('openai-api', `${FAKE_KEY} extra`)).toEqual({ ok: false, error: INVALID_KEY_ERROR });
    expect(await store.clearKey('nope')).toEqual({ ok: false, error: INVALID_PROVIDER_ERROR });
  });

  it('reports a fixed message when encryption throws, never the key', async () => {
    const cipher: KeyCipher = {
      ...fakeCipher(),
      encrypt: async (text) => {
        throw new Error(`could not encrypt ${text}`);
      },
    };
    const result = await new KeyStore(cipher, memoryFile()).setKey('openai-api', FAKE_KEY);
    expect(result).toEqual({ ok: false, error: SAVE_FAILED_ERROR });
  });

  it('treats an unreadable or corrupt file as having no keys', async () => {
    const file = memoryFile();
    file.text = '{not json';
    expect(await new KeyStore(fakeCipher(), file).listStatus()).toEqual([
      { id: 'anthropic-api', isSet: false },
      { id: 'openai-api', isSet: false },
      { id: 'openrouter', isSet: false },
    ]);
  });

  it('does not lose a save when two run at once', async () => {
    const store = new KeyStore(fakeCipher(), memoryFile());
    await Promise.all([store.setKey('openai-api', FAKE_KEY), store.setKey('openrouter', `${FAKE_KEY}-2`)]);
    expect(await store.getKey('openai-api')).toBe(FAKE_KEY);
    expect(await store.getKey('openrouter')).toBe(`${FAKE_KEY}-2`);
  });
});

describe('KeyStore when the file cannot be read', () => {
  it('fails a save instead of overwriting the other saved keys', async () => {
    const file = memoryFile();
    const store = new KeyStore(fakeCipher(), file);
    await store.setKey('openai-api', FAKE_KEY);
    const saved = file.text;
    const failingRead = file.read;
    file.read = async () => {
      throw new Error('EIO');
    };
    expect(await store.setKey('openrouter', `${FAKE_KEY}-2`)).toEqual({ ok: false, error: SAVE_FAILED_ERROR });
    expect(file.text).toBe(saved);
    file.read = failingRead;
    expect(await store.getKey('openai-api')).toBe(FAKE_KEY);
  });
});
