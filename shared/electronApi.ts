import type { FsApi } from './ipc/fs';
import type { StateApi } from './ipc/state';
import type { WindowsApi } from './ipc/windows';

/**
 * The API exposed on `window.electronAPI` by `electron/preload.ts`: one part
 * per IPC domain. A new domain adds its interface to this list.
 */
export interface ElectronAPI extends FsApi, StateApi, WindowsApi {
  /** Node's `process.platform` value, for example `linux`, `win32`, or `darwin`. */
  readonly platform: string;
}
