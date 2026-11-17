import { toIndexState, type IndexState, type RendererAction, type SharedState } from '../appState';
import type { IpcResult } from '../types';

export const STATE_CHANNELS = {
  get: 'state:get',
  dispatch: 'state:dispatch',
  /** Sent by the main process to every window after each change. */
  changed: 'state:changed',
} as const;

/**
 * The shared state at one point in time, as windows receive it: a thread
 * index without message text (Phase 3c). `version` grows by one with every
 * change.
 */
export interface StateSnapshot {
  version: number;
  state: IndexState;
}

/** Main's own snapshot, with every thread's messages. Never sent to a window. */
export interface FullStateSnapshot {
  version: number;
  state: SharedState;
}

/** What a window receives for main's snapshot: the same version, no messages. */
export function toStateSnapshot(snapshot: FullStateSnapshot): StateSnapshot {
  return { version: snapshot.version, state: toIndexState(snapshot.state) };
}

export interface StateApi {
  getAppState(): Promise<IpcResult<StateSnapshot>>;
  /** Asks the main process to change the shared state. The result arrives as a snapshot. */
  dispatch(action: RendererAction): Promise<IpcResult<null>>;
  /** Calls `listener` with every new snapshot. Returns a function that stops the calls. */
  onStateChanged(listener: (snapshot: StateSnapshot) => void): () => void;
}
