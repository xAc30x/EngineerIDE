import type { ApiKeyProvider } from '../../../shared/ipc/secrets';
import type { AIProviderStatus, Message } from '../../../shared/types';

/**
 * Shared pieces for the providers reached over HTTPS with an API key.
 * No Electron imports: `fetch` is injected so tests never touch the network.
 *
 * Key safety: these providers never pass text from the remote service, or
 * from a thrown error, on to the user. Some services quote part of the key in
 * their error messages, and a reply's error text is stored in shared state.
 * Every error a provider yields is one of the fixed messages built here.
 */

/** The parts of the global `fetch` the providers use. Tests pass a fake. */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

/** Where a provider gets its key. `KeyStore` satisfies this. */
export interface ApiKeySource {
  hasKey(provider: ApiKeyProvider): Promise<boolean>;
  getKey(provider: ApiKeyProvider): Promise<string | null>;
}

export const NO_KEY_REASON = 'No API key saved. Add one in Settings.';

export async function keyAvailability(keys: ApiKeySource, provider: ApiKeyProvider): Promise<AIProviderStatus> {
  return (await keys.hasKey(provider)) ? { available: true } : { available: false, reason: NO_KEY_REASON };
}

export function noKeyMessage(label: string): string {
  return `No ${label} key is saved. Add one in Settings.`;
}

export function unreachableMessage(label: string): string {
  return `Could not reach ${label}. Check your internet connection and try again.`;
}

export function interruptedMessage(label: string): string {
  return `The connection to ${label} ended before the reply finished.`;
}

/**
 * The message shown when a provider answers with an HTTP error status.
 * Built only from `label` and `status`, never from the response body.
 */
export function httpErrorMessage(label: string, status: number): string {
  if (status === 400) {
    return `${label} rejected the request (HTTP 400). If your account is out of credit, add some and try again.`;
  }
  if (status === 401) {
    return `${label} rejected the API key (HTTP 401). Check or replace it in Settings.`;
  }
  if (status === 402 || status === 403) {
    return `${label} refused the request (HTTP ${status}). Check that your account has credit and access to this model.`;
  }
  if (status === 404) {
    return `${label} could not find the model (HTTP 404). The default model name may be out of date.`;
  }
  if (status === 429) {
    return `${label} is limiting requests (HTTP 429). Wait a moment, or check your usage limits and credit.`;
  }
  if (status >= 500) {
    return `${label} is having trouble right now (HTTP ${status}). Try again in a few minutes.`;
  }
  return `${label} returned an error (HTTP ${status}).`;
}

/** The conversation as user/assistant turns: system notes and empty turns left out. */
export function chatTurns(messages: readonly Message[]): { role: 'user' | 'assistant'; content: string }[] {
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const message of messages) {
    if ((message.role === 'user' || message.role === 'assistant') && message.content.trim() !== '') {
      turns.push({ role: message.role, content: message.content });
    }
  }
  return turns;
}

/** One Server-Sent Event. */
export interface SseEvent {
  event: string | undefined;
  data: string;
}

/**
 * Splits a Server-Sent Events body into events. Stops when the body ends;
 * an aborted `fetch` makes the read reject, which the caller handles.
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer !== '') {
        // A last line with no newline still counts.
        buffer += '\n';
      }
      let newline = buffer.search(/\r?\n/);
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(buffer[newline] === '\r' ? newline + 2 : newline + 1);
        if (line === '') {
          if (data.length > 0) {
            yield { event, data: data.join('\n') };
          }
          event = undefined;
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        }
        // Comment lines (": ping") and other fields are ignored.
        newline = buffer.search(/\r?\n/);
      }
      if (done) {
        if (data.length > 0) {
          yield { event, data: data.join('\n') };
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parses JSON, or `undefined` when it is not valid JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
