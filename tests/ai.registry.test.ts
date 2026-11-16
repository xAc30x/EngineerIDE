import { describe, expect, it } from 'vitest';
import { createFakeProvider } from '../electron/ai/fakeProvider';
import { ProviderRegistry, TEST_REPLY_PREFIX, TEST_STAND_IN_REASON } from '../electron/ai/registry';
import { parseMessageContent, parseThreadId } from '../electron/ai/requests';
import { MAX_MESSAGE_LENGTH } from '../shared/ipc/ai';

async function collect(registry: ProviderRegistry): Promise<string> {
  const lookup = registry.get('openrouter');
  if (!lookup.ok) {
    throw new Error(lookup.error);
  }
  let text = '';
  const request = {
    messages: [{ id: 'm', role: 'user' as const, content: 'Hi', createdAt: 0 }],
    projectPath: null,
    signal: new AbortController().signal,
  };
  for await (const event of lookup.adapter.streamChat(request)) {
    if (event.type === 'text-delta') {
      text += event.text;
    }
  }
  return text;
}

describe('ProviderRegistry', () => {
  it('refuses a backend with no adapter when stand-ins are not allowed', async () => {
    const registry = new ProviderRegistry({ allowTestStandIn: false });
    expect(registry.get('openrouter')).toEqual({ ok: false, error: 'OpenRouter is not available yet.' });
    const listed = await registry.listAvailability();
    expect(listed.find((p) => p.id === 'openrouter')).toEqual({
      id: 'openrouter',
      label: 'OpenRouter',
      available: false,
      reason: 'OpenRouter is not available yet.',
    });
  });

  it('answers with a marked test reply when stand-ins are allowed', async () => {
    const registry = new ProviderRegistry({ allowTestStandIn: true });
    expect(registry.get('openrouter').ok).toBe(true);
    const listed = await registry.listAvailability();
    expect(listed.every((p) => p.available && p.reason === TEST_STAND_IN_REASON)).toBe(true);
  }, 15_000);

  it('prefers a registered adapter over the stand-in', async () => {
    const registry = new ProviderRegistry({ allowTestStandIn: true });
    registry.register(createFakeProvider({ id: 'openrouter', label: 'Real', chunkCount: 0, intervalMs: 0 }));
    expect(await collect(registry)).toBe('You said: "Hi". ');
  });

  it('marks stand-in replies with the test prefix', async () => {
    const registry = new ProviderRegistry({ allowTestStandIn: true });
    const lookup = registry.get('openrouter');
    if (!lookup.ok) {
      throw new Error(lookup.error);
    }
    const iterator = lookup.adapter
      .streamChat({ messages: [], projectPath: null, signal: new AbortController().signal })
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: 'text-delta' });
    expect((first.value as { text: string }).text.startsWith(TEST_REPLY_PREFIX)).toBe(true);
    await iterator.return?.();
  });

  it('reports a failing availability check as unavailable', async () => {
    const registry = new ProviderRegistry({ allowTestStandIn: false });
    registry.register({
      id: 'openrouter',
      label: 'Broken',
      checkAvailability: async () => {
        throw new Error('Not signed in');
      },
      streamChat: async function* () {},
    });
    const listed = await registry.listAvailability();
    expect(listed.find((p) => p.id === 'openrouter')).toMatchObject({ available: false, reason: 'Not signed in' });
  });
});

describe('fake provider', () => {
  it('stops yielding once the signal aborts', async () => {
    const controller = new AbortController();
    const adapter = createFakeProvider({ id: 'openrouter', label: 'Fake', chunkCount: 50, intervalMs: 5 });
    let count = 0;
    for await (const event of adapter.streamChat({ messages: [], projectPath: null, signal: controller.signal })) {
      count += 1;
      if (count === 2) {
        controller.abort();
      }
      expect(event.type).not.toBe('completed');
    }
    expect(count).toBeLessThan(5);
  });
});

describe('ai request validation', () => {
  it('accepts a thread id or null, and rejects anything else', () => {
    expect(parseThreadId('t1')).toBe('t1');
    expect(parseThreadId(null)).toBeNull();
    for (const bad of [undefined, '', 7, {}, 'x'.repeat(201)]) {
      expect(parseThreadId(bad)).toBeUndefined();
    }
  });

  it('accepts message text up to the limit', () => {
    expect(parseMessageContent('Hello')).toBe('Hello');
    expect(parseMessageContent('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toBeUndefined();
    expect(parseMessageContent({ text: 'Hello' })).toBeUndefined();
  });
});
