import { findThread } from '../../shared/appState';
import type { StartedReply } from '../../shared/ipc/ai';
import type { IpcResult } from '../../shared/types';
import type { AppStateStore } from '../appStateStore';
import type { StreamHub, StreamWriter } from '../streams/streamHub';
import type { AIChatRequest, AIProviderAdapter } from './adapter';
import type { ProviderRegistry } from './registry';

export const THREAD_BUSY_ERROR =
  'This chat is still replying. Wait for it to finish or stop it first.';
export const EMPTY_MESSAGE_ERROR = 'The message is empty.';
export const NOT_REPLYING_ERROR = 'This chat is not replying.';

export interface ReplyRunnerDependencies {
  hub: StreamHub;
  appState: AppStateStore;
  registry: ProviderRegistry;
}

/**
 * Starts provider replies in the main process and stores their outcome.
 *
 * The run lock is the thread's `runningReply` in the shared state: one source
 * of truth that both windows see. Everything from the lock check to
 * `startReply` runs without `await`, so two sends cannot both pass it.
 * No Electron imports, so it can be unit-tested.
 */
export class ReplyRunner {
  private readonly hub: StreamHub;
  private readonly appState: AppStateStore;
  private readonly registry: ProviderRegistry;

  constructor({ hub, appState, registry }: ReplyRunnerDependencies) {
    this.hub = hub;
    this.appState = appState;
    this.registry = registry;
  }

  /** Adds the user message and starts a reply. A refused send changes nothing. */
  send(threadId: string | null, content: string): IpcResult<StartedReply> {
    // 1. Checks that change nothing. (Async work a provider needs goes here,
    //    before the lock is checked.)
    if (content.trim() === '') {
      return { ok: false, error: EMPTY_MESSAGE_ERROR };
    }
    const backend = this.appState.getSnapshot().state.selectedBackend;
    const lookup = this.registry.get(backend);
    if (!lookup.ok) {
      return { ok: false, error: lookup.error };
    }

    // 2. The run lock. Synchronous from here until startReply.
    const known = threadId === null ? undefined : findThread(this.appState.getSnapshot().state, threadId);
    if (known !== undefined && known.runningReply !== null) {
      return { ok: false, error: THREAD_BUSY_ERROR };
    }

    // 3. Target thread: the given one, or a new (or reused empty) one.
    let targetId = known?.id ?? null;
    if (targetId === null) {
      this.appState.dispatch({ type: 'createThread' });
      targetId = this.appState.getSnapshot().state.activeThreadId;
      if (targetId === null) {
        return { ok: false, error: 'Could not create a chat for this message.' };
      }
    }

    // 4. Message, stream, lock.
    this.appState.dispatch({ type: 'sendMessage', threadId: targetId, content });
    const writer = this.hub.create();
    this.appState.dispatch({
      type: 'startReply',
      threadId: targetId,
      streamId: writer.id,
      provider: backend,
    });

    const state = this.appState.getSnapshot().state;
    const request: AIChatRequest = {
      messages: (findThread(state, targetId)?.messages ?? []).filter((m) => m.role !== 'system'),
      projectPath: state.activeProjectPath,
      signal: writer.signal,
    };
    const finishedThreadId = targetId;
    void writer.finished.then((result) => {
      try {
        this.appState.dispatch({
          type: 'finishReply',
          threadId: finishedThreadId,
          streamId: result.streamId,
          outcome: {
            status: result.status,
            text: result.text,
            ...(result.error === undefined ? {} : { error: result.error }),
          },
        });
      } catch (error) {
        console.error('Could not store a finished reply:', error);
      } finally {
        // Released after the message is stored, so no window loses the text.
        this.hub.release(result.streamId);
      }
    });
    void pump(lookup.adapter, request, writer);

    return { ok: true, value: { threadId: targetId, streamId: writer.id } };
  }

  /** Stops the thread's running reply. */
  cancel(threadId: string): IpcResult<null> {
    const thread = findThread(this.appState.getSnapshot().state, threadId);
    if (thread?.runningReply == null) {
      return { ok: false, error: NOT_REPLYING_ERROR };
    }
    this.hub.cancel(thread.runningReply.streamId);
    return { ok: true, value: null };
  }
}

/** Copies the adapter's events into the stream. Never throws. */
async function pump(
  adapter: AIProviderAdapter,
  request: AIChatRequest,
  writer: StreamWriter,
): Promise<void> {
  try {
    for await (const event of adapter.streamChat(request)) {
      if (writer.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'text-delta':
          writer.append(event.text);
          break;
        case 'completed':
          writer.complete();
          return;
        case 'error':
          writer.fail(event.message);
          return;
      }
    }
    // An adapter that ends without saying so has finished normally.
    writer.complete();
  } catch (error) {
    writer.fail(error instanceof Error ? error.message : String(error));
  }
}
