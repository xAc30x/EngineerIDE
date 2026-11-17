import type { AIChatRequest, AIProviderAdapter, AIStreamEvent } from '../adapter';
import {
  interruptedMessage,
  chatTurns,
  httpErrorMessage,
  isRecord,
  keyAvailability,
  noKeyMessage,
  parseJson,
  readSseEvents,
  unreachableMessage,
  type ApiKeySource,
  type FetchFunction,
} from './http';

/**
 * The Anthropic API provider: the Messages API with streaming, using the key
 * saved in Settings. Raw `fetch` rather than the SDK, so 2d adds no
 * dependency. No Electron imports, so it can be unit-tested with a fake fetch.
 */

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2026-10-21';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
/** Room for a long reply; streaming avoids request timeouts. */
export const ANTHROPIC_MAX_TOKENS = 64_000;

const LABEL = 'Anthropic API';

export interface AnthropicApiOptions {
  keys: ApiKeySource;
  fetch?: FetchFunction;
}

export function createAnthropicApiProvider({ keys, fetch = globalThis.fetch }: AnthropicApiOptions): AIProviderAdapter {
  return {
    id: 'anthropic-api',
    label: LABEL,
    checkAvailability: () => keyAvailability(keys, 'anthropic-api'),
    async *streamChat(request: AIChatRequest): AsyncIterable<AIStreamEvent> {
      const key = await keys.getKey('anthropic-api');
      if (key === null) {
        yield { type: 'error', message: noKeyMessage(LABEL) };
        return;
      }

      let response: Response;
      try {
        response = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model: request.model ?? ANTHROPIC_DEFAULT_MODEL,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            stream: true,
            messages: chatTurns(request.messages),
          }),
          signal: request.signal,
        });
      } catch {
        if (!request.signal.aborted) {
          yield { type: 'error', message: unreachableMessage(LABEL) };
        }
        return;
      }

      if (!response.ok || response.body === null) {
        // The body is never read: it could quote the key.
        await response.body?.cancel().catch(() => undefined);
        yield { type: 'error', message: httpErrorMessage(LABEL, response.status) };
        return;
      }

      try {
        for await (const { data } of readSseEvents(response.body)) {
          const event = parseJson(data);
          if (!isRecord(event)) {
            continue;
          }
          switch (event.type) {
            case 'content_block_delta': {
              const delta = event.delta;
              if (isRecord(delta) && delta.type === 'text_delta' && typeof delta.text === 'string') {
                yield { type: 'text-delta', text: delta.text };
              }
              break;
            }
            case 'message_delta': {
              const delta = event.delta;
              if (isRecord(delta) && delta.stop_reason === 'refusal') {
                yield { type: 'error', message: `${LABEL} declined to answer this request.` };
                return;
              }
              break;
            }
            case 'message_stop':
              yield { type: 'completed' };
              return;
            case 'error': {
              const error = event.error;
              const kind = isRecord(error) && typeof error.type === 'string' ? error.type : 'unknown';
              // Only the error's type name is shown, never its message text.
              yield { type: 'error', message: `${LABEL} stopped the reply (${safeErrorType(kind)}).` };
              return;
            }
          }
        }
      } catch {
        if (!request.signal.aborted) {
          yield { type: 'error', message: unreachableMessage(LABEL) };
        }
        return;
      }
      if (!request.signal.aborted) {
        // The stream ended without message_stop: the connection dropped.
        yield { type: 'error', message: interruptedMessage(LABEL) };
      }
    },
  };
}

/** An error type name such as `overloaded_error`, or `unknown` if it looks like anything else. */
function safeErrorType(kind: string): string {
  return /^[a-z_]{1,40}$/.test(kind) ? kind : 'unknown';
}
