import type { AIProviderStatus, BackendProvider, Message } from '../../shared/types';

/**
 * The provider contract. It lives in the main process because `AbortSignal`
 * and `AsyncIterable` cannot cross IPC; windows use `shared/ipc/ai.ts`.
 */

export interface AIChatRequest {
  /** Full conversation so far, oldest first. */
  messages: readonly Message[];
  /** Folder the conversation is working in, if one is selected. */
  projectPath: string | null;
  /** Provider-specific model name. The adapter picks its default when omitted. */
  model?: string;
  /** Aborted when the reply is cancelled. The adapter must stop when it fires. */
  signal: AbortSignal;
}

export type AIStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'completed' }
  | { type: 'error'; message: string };

/**
 * One implementation per backend. UI components never see it, so a backend
 * can be added or replaced without changing them.
 */
export interface AIProviderAdapter {
  readonly id: BackendProvider;
  /** Name shown in the backend selector. */
  readonly label: string;
  /** Reports whether the backend is installed/configured and ready to use. */
  checkAvailability(): Promise<AIProviderStatus>;
  /** Sends the conversation and yields the reply as it is produced. */
  streamChat(request: AIChatRequest): AsyncIterable<AIStreamEvent>;
}
