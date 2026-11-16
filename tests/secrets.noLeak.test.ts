import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAnthropicApiProvider } from '../electron/ai/providers/anthropicApi';
import type { FetchFunction } from '../electron/ai/providers/http';
import { createOpenAiProvider, createOpenRouterProvider } from '../electron/ai/providers/openAiCompatible';
import { ProviderRegistry } from '../electron/ai/registry';
import { ReplyRunner } from '../electron/ai/replies';
import { AppStateStore } from '../electron/appStateStore';
import { KeyStore, type KeyCipher, type KeyFile } from '../electron/secrets/keyStore';
import { StreamHub } from '../electron/streams/streamHub';
import { findThread } from '../shared/appState';
import type { ApiKeyProvider } from '../shared/ipc/secrets';

/**
 * Phase 2d's "Done when": a saved key never appears in a state snapshot, a
 * stream, or anything else a window can receive. Runs the real reply runner,
 * stream hub, state store and key store; only `fetch` and the cipher are fake.
 * Each scenario tries to leak the key: the "server" echoes it in a 401 body
 * and a mid-stream error, and the network layer throws an error quoting it.
 */

// An obviously fake key, distinctive enough that any leak is found.
const SENTINEL_KEY = 'sk-SENTINEL-fake-key-7f3a9c';

const fakeCipher: KeyCipher = {
  isAvailable: async () => true,
  encrypt: async (text) => new TextEncoder().encode(text).reverse(),
  decrypt: async (bytes) => new TextDecoder().decode(new Uint8Array(bytes).reverse()),
};

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

function sse(parts: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    }),
  );
}

type Scenario = 'success' | 'echo-401' | 'throws' | 'mid-stream-error';

/** A fake server that misbehaves in the way `scenario` names, quoting the key it was sent. */
function leakyFetch(scenario: Scenario): FetchFunction {
  return async (url, init) => {
    const headers = init.headers as Record<string, string>;
    const sentKey = headers['x-api-key'] ?? headers.authorization ?? '';
    const isAnthropic = url.includes('anthropic.com');
    switch (scenario) {
      case 'throws':
        throw new Error(`TLS failure while sending ${sentKey}`);
      case 'echo-401':
        return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${sentKey}` } }), {
          status: 401,
        });
      case 'mid-stream-error':
        return isAnthropic
          ? sse([
              `event: error\ndata: {"type":"error","error":{"type":"authentication_error","message":"bad ${sentKey}"}}\n\n`,
            ])
          : sse([`data: {"error":{"message":"bad ${sentKey}"}}\n\n`]);
      case 'success':
        return isAnthropic
          ? sse([
              'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi there"}}\n\n',
              'data: {"type":"message_stop"}\n\n',
            ])
          : sse(['data: {"choices":[{"delta":{"content":"Hi there"}}]}\n\n', 'data: [DONE]\n\n']);
    }
  };
}

let hub: StreamHub;
let appState: AppStateStore;

beforeEach(() => {
  hub = new StreamHub({ flushIntervalMs: 1 });
  appState = new AppStateStore();
});

afterEach(() => {
  hub.dispose();
});

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the reply to finish.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const PROVIDERS: readonly ApiKeyProvider[] = ['anthropic-api', 'openai-api', 'openrouter'];
const SCENARIOS: readonly Scenario[] = ['success', 'echo-401', 'throws', 'mid-stream-error'];

describe('API keys never reach a window', () => {
  it.each(PROVIDERS.flatMap((provider) => SCENARIOS.map((scenario) => ({ provider, scenario }))))(
    '$provider, $scenario',
    async ({ provider, scenario }) => {
      const keyFile = memoryFile();
      const keys = new KeyStore(fakeCipher, keyFile);
      const exposed: unknown[] = [];

      // Saving the key: the result goes back to the window.
      exposed.push(await keys.setKey(provider, SENTINEL_KEY));
      exposed.push(await keys.listStatus());

      const fetch = leakyFetch(scenario);
      const registry = new ProviderRegistry({ allowTestStandIn: false });
      registry.register(createAnthropicApiProvider({ keys, fetch }));
      registry.register(createOpenAiProvider({ keys, fetch }));
      registry.register(createOpenRouterProvider({ keys, fetch }));
      exposed.push(await registry.listAvailability());

      // Every snapshot main broadcasts, and every stream chunk it sends.
      appState.subscribe((snapshot) => exposed.push(snapshot));
      appState.dispatch({ type: 'setSelectedBackend', backend: provider });
      const runner = new ReplyRunner({ hub, appState, registry });
      const sent = runner.send(null, 'Hello');
      exposed.push(sent);
      if (!sent.ok) {
        throw new Error(`Expected the send to be accepted: ${sent.error}`);
      }
      hub.subscribe(sent.value.streamId, 'window', 0, (delta) => {
        exposed.push(delta);
        return true;
      });
      await until(() => findThread(appState.getSnapshot().state, sent.value.threadId)?.runningReply === null);
      exposed.push(appState.getSnapshot());

      // The test is only meaningful if the key really was sent to the server.
      expect(await keys.getKey(provider)).toBe(SENTINEL_KEY);
      const replies = findThread(appState.getSnapshot().state, sent.value.threadId)?.messages ?? [];
      expect(replies.length).toBeGreaterThan(1);
      if (scenario === 'success') {
        expect(replies.at(-1)?.content).toBe('Hi there');
      } else {
        expect(replies.at(-1)?.role).toBe('system');
      }

      const everything = JSON.stringify(exposed);
      expect(everything).not.toContain(SENTINEL_KEY);
      // Not even a prefix, as some services show in their error messages.
      expect(everything).not.toContain(SENTINEL_KEY.slice(0, 12));
      // At rest, the file holds only the encrypted form.
      expect(keyFile.text).not.toContain(SENTINEL_KEY);
    },
  );
});
