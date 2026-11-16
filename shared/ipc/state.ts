import type { RendererAction, SharedState } from '../appState';
import type { IpcResult } from '../types';

export const STATE_CHANNELS = {
  get: 'state:get',
  dispatch: 'state:dispatch',
  /** Sent by the main process to every window after each change. */
  changed: 'state:changed',
} as const;

/** The shared state at one point in time. `version` grows by one with every change. */
export interface StateSnapshot {
  version: number;
  state: SharedState;
}

export interface StateApi {
  getAppState(): Promise<IpcResult<StateSnapshot>>;
  /** Asks the main process to change the shared state. The result arrives as a snapshot. */
  dispatch(action: RendererAction): Promise<IpcResult<null>>;
  /** Calls `listener` with every new snapshot. Returns a function that stops the calls. */
  onStateChanged(listener: (snapshot: StateSnapshot) => void): () => void;
}
