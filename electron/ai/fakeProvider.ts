import type { BackendProvider } from '../../shared/types';
import type { AIChatRequest, AIProviderAdapter, AIStreamEvent } from './adapter';

export interface FakeProviderOptions {
  id: BackendProvider;
  label: string;
  /** Text put before the reply, for example to mark it as a test reply. */
  prefix?: string;
  /** Number of chunks after the prefix. */
  chunkCount?: number;
  /** Delay before each chunk, in milliseconds. 0 yields without waiting on a timer. */
  intervalMs?: number;
  /** When set, the reply fails with this message after the chunks. */
  failWith?: string;
}

/** About 10 seconds: long enough to reload or stop a window mid-reply by hand. */
export const FAKE_PROVIDER_DEFAULTS = { chunkCount: 80, intervalMs: 125 } as const;

/** Chunk `index` (from 0) of a fake reply, so a test can predict the whole text. */
export function fakeChunkText(index: number, chunkCount: number): string {
  return `Part ${index + 1} of ${chunkCount}. `;
}

function lastUserText(request: AIChatRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === 'user') {
      return message.content;
    }
  }
  return '';
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * A provider with predictable output, for tests and for development builds
 * before a real backend exists. It quotes the last user message, then yields
 * numbered chunks, and stops as soon as the request's signal aborts.
 */
export function createFakeProvider(options: FakeProviderOptions): AIProviderAdapter {
  const chunkCount = options.chunkCount ?? FAKE_PROVIDER_DEFAULTS.chunkCount;
  const intervalMs = options.intervalMs ?? FAKE_PROVIDER_DEFAULTS.intervalMs;
  return {
    id: options.id,
    label: options.label,
    checkAvailability: async () => ({ available: true }),
    async *streamChat(request): AsyncIterable<AIStreamEvent> {
      const { signal } = request;
      yield { type: 'text-delta', text: `${options.prefix ?? ''}You said: "${lastUserText(request)}". ` };
      for (let index = 0; index < chunkCount; index += 1) {
        await wait(intervalMs, signal);
        if (signal.aborted) {
          return;
        }
        yield { type: 'text-delta', text: fakeChunkText(index, chunkCount) };
      }
      if (options.failWith !== undefined) {
        yield { type: 'error', message: options.failWith };
        return;
      }
      yield { type: 'completed' };
    },
  };
}
