import type { ApiKeyProvider } from '../../../shared/ipc/secrets';
import type { AIChatRequest, AIProviderAdapter, AIStreamEvent } from '../adapter';
import {
  chatTurns,
  httpErrorMessage,
  interruptedMessage,
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
 * Providers that speak the OpenAI Chat Completions streaming format: the
 * OpenAI API itself and OpenRouter. Each is this one implementation with its
 * own address, label and default model. No Electron imports, so it can be
 * unit-tested with a fake fetch.
 */

interface OpenAiCompatibleConfig {
  id: ApiKeyProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const OPENAI_CONFIG: OpenAiCompatibleConfig = {
  id: 'openai-api',
  label: 'OpenAI API',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-6-luna',
};

export const OPENROUTER_CONFIG: OpenAiCompatibleConfig = {
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'anthropic/claude-opus-5.5',
};

export interface OpenAiCompatibleOptions {
  keys: ApiKeySource;
  fetch?: FetchFunction;
}

export function createOpenAiProvider(options: OpenAiCompatibleOptions): AIProviderAdapter {
  return createOpenAiCompatibleProvider(OPENAI_CONFIG, options);
}

export function createOpenRouterProvider(options: OpenAiCompatibleOptions): AIProviderAdapter {
  return createOpenAiCompatibleProvider(OPENROUTER_CONFIG, options);
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleConfig,
  { keys, fetch = globalThis.fetch }: OpenAiCompatibleOptions,
): AIProviderAdapter {
  const { id, label } = config;
  return {
    id,
    label,
    checkAvailability: () => keyAvailability(keys, id),
    async *streamChat(request: AIChatRequest): AsyncIterable<AIStreamEvent> {
      const key = await keys.getKey(id);
      if (key === null) {
        yield { type: 'error', message: noKeyMessage(label) };
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: request.model ?? config.defaultModel,
            stream: true,
            messages: chatTurns(request.messages),
          }),
          signal: request.signal,
        });
      } catch {
        if (!request.signal.aborted) {
          yield { type: 'error', message: unreachableMessage(label) };
        }
        return;
      }

      if (!response.ok || response.body === null) {
        // The body is never read: OpenAI quotes part of a rejected key in it.
        await response.body?.cancel().catch(() => undefined);
        yield { type: 'error', message: httpErrorMessage(label, response.status) };
        return;
      }

      try {
        for await (const { data } of readSseEvents(response.body)) {
          if (data === '[DONE]') {
            yield { type: 'completed' };
            return;
          }
          const chunk = parseJson(data);
          if (!isRecord(chunk)) {
            continue;
          }
          if (chunk.error !== undefined) {
            // A mid-stream error (OpenRouter sends these). Its text is not shown.
            yield { type: 'error', message: `${label} stopped the reply with an error.` };
            return;
          }
          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
          if (!isRecord(choice)) {
            continue;
          }
          const delta = choice.delta;
          if (isRecord(delta) && typeof delta.content === 'string' && delta.content !== '') {
            yield { type: 'text-delta', text: delta.content };
          }
          if (choice.finish_reason === 'content_filter') {
            yield { type: 'error', message: `${label} declined to answer this request.` };
            return;
          }
        }
      } catch {
        if (!request.signal.aborted) {
          yield { type: 'error', message: unreachableMessage(label) };
        }
        return;
      }
      if (!request.signal.aborted) {
        // The stream ended without [DONE]: the connection dropped.
        yield { type: 'error', message: interruptedMessage(label) };
      }
    },
  };
}
