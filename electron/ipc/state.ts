import { parseAction } from '../../shared/appState';
import { STATE_CHANNELS, toStateSnapshot, type StateSnapshot } from '../../shared/ipc/state';
import type { AppStateStore } from '../appStateStore';
import type { ThreadLoader } from '../storage/threadLoader';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface StateIpcDependencies {
  windows: WindowRegistry;
  appState: AppStateStore;
  threadLoader: ThreadLoader;
}

export function registerStateIpc({ windows, appState, threadLoader }: StateIpcDependencies): void {
  handleFromAppWindow<StateSnapshot>(STATE_CHANNELS.get, windows, () => ({
    ok: true,
    // Windows get the thread index; messages come from threads:getMessages.
    value: toStateSnapshot(appState.getSnapshot()),
  }));

  handleFromAppWindow<null>(STATE_CHANNELS.dispatch, windows, async (_event, payload) => {
    const action = parseAction(payload);
    if (action === null) {
      return { ok: false, error: 'Request rejected: it is not a valid state change.' };
    }
    // A message can only be added once the thread's earlier ones are loaded.
    if (action.type === 'sendMessage' && action.threadId !== null) {
      const loaded = await threadLoader.ensureLoaded(action.threadId);
      if (!loaded.ok) {
        return loaded;
      }
    }
    appState.dispatch(action);
    return { ok: true, value: null };
  });

  // Every change goes to every window, including the one that asked for it.
  appState.subscribe((snapshot) =>
    windows.broadcast(STATE_CHANNELS.changed, toStateSnapshot(snapshot)),
  );
}
