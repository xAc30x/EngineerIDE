import { parseAction } from '../../shared/appState';
import { STATE_CHANNELS, type StateSnapshot } from '../../shared/ipc/state';
import type { AppStateStore } from '../appStateStore';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface StateIpcDependencies {
  windows: WindowRegistry;
  appState: AppStateStore;
}

export function registerStateIpc({ windows, appState }: StateIpcDependencies): void {
  handleFromAppWindow<StateSnapshot>(STATE_CHANNELS.get, windows, () => ({
    ok: true,
    value: appState.getSnapshot(),
  }));

  handleFromAppWindow<null>(STATE_CHANNELS.dispatch, windows, (_event, payload) => {
    const action = parseAction(payload);
    if (action === null) {
      return { ok: false, error: 'Request rejected: it is not a valid state change.' };
    }
    appState.dispatch(action);
    return { ok: true, value: null };
  });

  // Every change goes to every window, including the one that asked for it.
  appState.subscribe((snapshot) => windows.broadcast(STATE_CHANNELS.changed, snapshot));
}
