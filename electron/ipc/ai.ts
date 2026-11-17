import { app } from 'electron';
import { AI_CHANNELS, type StartedReply } from '../../shared/ipc/ai';
import type { ProviderAvailability } from '../../shared/types';
import { createAnthropicApiProvider } from '../ai/providers/anthropicApi';
import { createClaudeCliProvider } from '../ai/providers/claudeCli';
import { createOpenAiProvider, createOpenRouterProvider } from '../ai/providers/openAiCompatible';
import { ProviderRegistry } from '../ai/registry';
import { ReplyRunner } from '../ai/replies';
import { parseMessageContent, parseThreadId } from '../ai/requests';
import type { AppStateStore } from '../appStateStore';
import type { KeyStore } from '../secrets/keyStore';
import type { StreamHub } from '../streams/streamHub';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface AiIpcDependencies {
  windows: WindowRegistry;
  appState: AppStateStore;
  streams: StreamHub;
  /** Saved API keys, read by the API-key providers when a reply starts. */
  secrets: KeyStore;
}

/** Registers the `ai:*` handlers. Replies run in main and stream through `streams`. */
export function registerAiIpc({ windows, appState, streams, secrets }: AiIpcDependencies): void {
  // Packaged builds never answer with the fake provider.
  const registry = new ProviderRegistry({ allowTestStandIn: !app.isPackaged });
  const claudeCli = createClaudeCliProvider();
  registry.register(claudeCli);
  // No CLI child process outlives the app.
  app.on('will-quit', () => claudeCli.stopAll());
  registry.register(createAnthropicApiProvider({ keys: secrets }));
  registry.register(createOpenAiProvider({ keys: secrets }));
  registry.register(createOpenRouterProvider({ keys: secrets }));
  const replies = new ReplyRunner({ hub: streams, appState, registry });

  handleFromAppWindow<StartedReply>(AI_CHANNELS.sendMessage, windows, (_event, threadIdValue, contentValue) => {
    const threadId = parseThreadId(threadIdValue);
    const content = parseMessageContent(contentValue);
    if (threadId === undefined || content === undefined) {
      return { ok: false, error: 'Request rejected: it is not a valid message.' };
    }
    return replies.send(threadId, content);
  });

  handleFromAppWindow<null>(AI_CHANNELS.cancelReply, windows, (_event, threadIdValue) => {
    const threadId = parseThreadId(threadIdValue);
    if (typeof threadId !== 'string') {
      return { ok: false, error: 'Request rejected: the thread id is not valid.' };
    }
    return replies.cancel(threadId);
  });

  handleFromAppWindow<ProviderAvailability[]>(AI_CHANNELS.listProviders, windows, async () => ({
    ok: true,
    value: await registry.listAvailability(),
  }));
}
