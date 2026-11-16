import { describe, expect, it } from 'vitest';
import type { AIProviderAdapter, AIStreamEvent } from '../electron/ai/adapter';
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MESSAGES_URL,
  createAnthropicApiProvider,
} from '../electron/ai/providers/anthropicApi';
import {
  NO_KEY_REASON,
  httpErrorMessage,
  readSseEvents,
  type ApiKeySource,
  type FetchFunction,
} from '../electron/ai/providers/http';
import {
  OPENAI_CONFIG,
  OPENROUTER_CONFIG,
  createOpenAiProvider,
  createOpenRouterProvider,
} from '../electron/ai/providers/openAiCompatible';
import type { ApiKeyProvider } from '../shared/ipc/secrets';
import type { Message } from '../shared/types';

// An obviously fake key. No real key or network is ever used in these tests.
const FAKE_KEY = 'fake-test-key-DO-NOT-LEAK-42';

function keys(saved: Partial<Record<ApiKeyProvider, string>>): ApiKeySource {
  return {
    hasKey: async (provider) => saved[provider] !== undefined,
    getKey: async (provider) => saved[provider] ?? null,
  };
}

/** A response body that sends `parts` one by one. */
function sseBody(parts: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

interface FakeCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetch: FetchFunction; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

function message(role: Message['role'], content: string): Message {
  return { id: `${role}-${content}`, role, content, createdAt: 0 };
}

async function collect(adapter: AIProviderAdapter, signal = new AbortController().signal): Promise<AIStreamEvent[]> {
  const events: AIStreamEvent[] = [];
  for await (const event of adapter.streamChat({
    messages: [message('user', 'Hi'), message('system', 'Reply stopped.'), message('assistant', ''), message('user', 'Again')],
    projectPath: null,
    signal,
  })) {
    events.push(event);
  }
  return events;
}

function text(events: readonly AIStreamEvent[]): string {
  return events.map((event) => (event.type === 'text-delta' ? event.text : '')).join('');
}

const anthropicStream = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
  // A chunk boundary in the middle of an event.
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_',
  'delta","text":"lo"}}\r\n\r\n',
  ': ping\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

const openAiStream = [
  'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
  ': OPENROUTER PROCESSING\n\n',
  'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
];

describe('readSseEvents', () => {
  it('joins multi-line data and ignores comments', async () => {
    const events = [];
    for await (const event of readSseEvents(sseBody(['event: a\ndata: one\ndata: two\n\n: c\n\ndata: last']))) {
      events.push(event);
    }
    expect(events).toEqual([
      { event: 'a', data: 'one\ntwo' },
      { event: undefined, data: 'last' },
    ]);
  });
});

describe('httpErrorMessage', () => {
  it.each([
    [401, 'rejected the API key'],
    [403, 'refused the request'],
    [404, 'could not find the model'],
    [429, 'limiting requests'],
    [503, 'having trouble'],
    [418, 'returned an error (HTTP 418)'],
  ])('explains HTTP %i', (status, expected) => {
    const message = httpErrorMessage('Test API', status);
    expect(message).toContain(expected);
    expect(message.startsWith('Test API ')).toBe(true);
    expect(message).toContain(String(status));
  });
});

describe('Anthropic API provider', () => {
  it('is unavailable until a key is saved', async () => {
    expect(await createAnthropicApiProvider({ keys: keys({}) }).checkAvailability()).toEqual({
      available: false,
      reason: NO_KEY_REASON,
    });
    expect(
      await createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }) }).checkAvailability(),
    ).toEqual({ available: true });
  });

  it('streams text deltas and completes, sending the key only as a header', async () => {
    const fake = fakeFetch(() => new Response(sseBody(anthropicStream), { status: 200 }));
    const adapter = createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch: fake.fetch });
    const events = await collect(adapter);
    expect(text(events)).toBe('Hello');
    expect(events.at(-1)).toEqual({ type: 'completed' });

    const [call] = fake.calls;
    expect(call?.url).toBe(ANTHROPIC_MESSAGES_URL);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(FAKE_KEY);
    expect(headers['anthropic-version']).toBe(ANTHROPIC_API_VERSION);
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(body.stream).toBe(true);
    // System notes and empty turns are left out.
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'Again' },
    ]);
    expect(String(call?.init.body)).not.toContain(FAKE_KEY);
  });

  it('fails without calling the API when no key is saved', async () => {
    const fake = fakeFetch(() => new Response(sseBody(anthropicStream)));
    const events = await collect(createAnthropicApiProvider({ keys: keys({}), fetch: fake.fetch }));
    expect(fake.calls).toHaveLength(0);
    expect(events).toEqual([{ type: 'error', message: 'No Anthropic API key is saved. Add one in Settings.' }]);
  });

  it('reports an HTTP error by status only, never the body', async () => {
    const fake = fakeFetch(
      () => new Response(JSON.stringify({ error: { message: `invalid x-api-key ${FAKE_KEY}` } }), { status: 401 }),
    );
    const events = await collect(
      createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch: fake.fetch }),
    );
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('error');
    expect(JSON.stringify(events)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(events)).not.toContain('invalid x-api-key');
  });

  it('reports a mid-stream error by type only', async () => {
    const fake = fakeFetch(
      () =>
        new Response(
          sseBody([
            anthropicStream[1] ?? '',
            `event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"secret ${FAKE_KEY}"}}\n\n`,
          ]),
        ),
    );
    const events = await collect(
      createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch: fake.fetch }),
    );
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Anthropic API stopped the reply (overloaded_error).' });
  });

  it('turns a refusal into an error', async () => {
    const fake = fakeFetch(
      () =>
        new Response(
          sseBody(['event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n']),
        ),
    );
    const events = await collect(
      createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch: fake.fetch }),
    );
    expect(events).toEqual([{ type: 'error', message: 'Anthropic API declined to answer this request.' }]);
  });

  it('reports a dropped connection when the stream ends early', async () => {
    const fake = fakeFetch(() => new Response(sseBody(anthropicStream.slice(0, 2))));
    const events = await collect(
      createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch: fake.fetch }),
    );
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'The connection to Anthropic API ended before the reply finished.',
    });
  });

  it('reports a network failure without its text', async () => {
    const fetch: FetchFunction = async () => {
      throw new Error(`connect failed for key ${FAKE_KEY}`);
    };
    const events = await collect(createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch }));
    expect(events).toEqual([
      { type: 'error', message: 'Could not reach Anthropic API. Check your internet connection and try again.' },
    ]);
  });

  it('ends quietly when cancelled, passing the signal to fetch', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | null | undefined;
    const fetch: FetchFunction = (_url, init) => {
      seenSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    const adapter = createAnthropicApiProvider({ keys: keys({ 'anthropic-api': FAKE_KEY }), fetch });
    const pending = collect(adapter, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toEqual([]);
    expect(seenSignal).toBe(controller.signal);
  });
});

describe.each([
  { name: 'OpenAI API', config: OPENAI_CONFIG, create: createOpenAiProvider },
  { name: 'OpenRouter', config: OPENROUTER_CONFIG, create: createOpenRouterProvider },
])('$name provider', ({ config, create }) => {
  const saved = { [config.id]: FAKE_KEY };

  it('is unavailable until a key is saved', async () => {
    expect((await create({ keys: keys({}) }).checkAvailability()).available).toBe(false);
    expect((await create({ keys: keys(saved) }).checkAvailability()).available).toBe(true);
  });

  it('streams text deltas and completes on [DONE]', async () => {
    const fake = fakeFetch(() => new Response(sseBody(openAiStream)));
    const events = await collect(create({ keys: keys(saved), fetch: fake.fetch }));
    expect(text(events)).toBe('Hello');
    expect(events.at(-1)).toEqual({ type: 'completed' });

    const [call] = fake.calls;
    expect(call?.url).toBe(`${config.baseUrl}/chat/completions`);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe(config.defaultModel);
    expect(String(call?.init.body)).not.toContain(FAKE_KEY);
  });

  it('reports an HTTP error without the body, which may quote the key', async () => {
    const fake = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_KEY.slice(0, 12)}***` } }), {
          status: 401,
        }),
    );
    const events = await collect(create({ keys: keys(saved), fetch: fake.fetch }));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    expect(JSON.stringify(events)).not.toContain(FAKE_KEY.slice(0, 12));
    expect(JSON.stringify(events)).not.toContain('Incorrect API key');
  });

  it('reports a mid-stream error without its text', async () => {
    const fake = fakeFetch(
      () => new Response(sseBody([openAiStream[1] ?? '', `data: {"error":{"message":"bad ${FAKE_KEY}"}}\n\n`])),
    );
    const events = await collect(create({ keys: keys(saved), fetch: fake.fetch }));
    expect(text(events)).toBe('Hel');
    expect(events.at(-1)).toEqual({ type: 'error', message: `${config.label} stopped the reply with an error.` });
  });

  it('reports a dropped connection when [DONE] never arrives', async () => {
    const fake = fakeFetch(() => new Response(sseBody(openAiStream.slice(0, 2))));
    const events = await collect(create({ keys: keys(saved), fetch: fake.fetch }));
    expect(events.at(-1)?.type).toBe('error');
  });
});
