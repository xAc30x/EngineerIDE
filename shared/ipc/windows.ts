import type { IpcResult, WindowKind } from '../types';

export const WINDOW_CHANNELS = {
  show: 'window:show',
} as const;

export interface WindowsApi {
  /** Opens the given window, or brings it to the front when it is already open. */
  showWindow(kind: WindowKind): Promise<IpcResult<null>>;
}
