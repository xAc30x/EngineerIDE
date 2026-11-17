import { THREADS_CHANNELS } from '../../shared/ipc/threads';
import type { Message } from '../../shared/types';
import type { AppStateStore } from '../appStateStore';
import type { ThreadLoader } from '../storage/threadLoader';
import { fetchThreadMessages } from '../threadMessages';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface ThreadsIpcDependencies {
  windows: WindowRegistry;
  appState: AppStateStore;
  threadLoader: ThreadLoader;
}

export function registerThreadsIpc({ windows, appState, threadLoader }: ThreadsIpcDependencies): void {
  handleFromAppWindow<Message[]>(THREADS_CHANNELS.getMessages, windows, (_event, threadId) =>
    fetchThreadMessages(appState, threadLoader, threadId),
  );
}
