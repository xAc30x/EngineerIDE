import { WINDOW_CHANNELS } from '../../shared/ipc/windows';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface WindowsIpcDependencies {
  windows: WindowRegistry;
}

export function registerWindowsIpc({ windows }: WindowsIpcDependencies): void {
  handleFromAppWindow<null>(WINDOW_CHANNELS.show, windows, (_event, kind) => {
    if (kind !== 'workspace' && kind !== 'ide') {
      return { ok: false, error: 'Request rejected: unknown window.' };
    }
    windows.show(kind);
    return { ok: true, value: null };
  });
}
