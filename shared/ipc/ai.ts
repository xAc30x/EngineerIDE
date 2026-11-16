import type { IpcResult, ProviderAvailability } from '../types';

export const AI_CHANNELS = {
  sendMessage: 'ai:sendMessage',
  cancelReply: 'ai:cancelReply',
  listProviders: 'ai:listProviders',
} as const;

/** Longest message a window may send, in characters. */
export const MAX_MESSAGE_LENGTH = 100_000;

/** Where a sent message went and which stream carries its reply. */
export interface StartedReply {
  threadId: string;
  streamId: string;
}

export interface AiApi {
  /**
   * Adds a user message to `threadId` (a new thread when `null` or unknown)
   * and starts a reply from the selected backend. Refused, with nothing
   * changed, when the thread is already replying or no provider is available.
   */
  sendChatMessage(threadId: string | null, content: string): Promise<IpcResult<StartedReply>>;
  /** Stops the thread's running reply for every window. */
  cancelReply(threadId: string): Promise<IpcResult<null>>;
  /** Every backend, in display order, with whether it can reply now. */
  listProviders(): Promise<IpcResult<ProviderAvailability[]>>;
}
