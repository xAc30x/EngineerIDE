import {
  applyAction,
  createInitialSharedState,
  type SharedAction,
  type SharedState,
} from '../shared/appState';
import type { FullStateSnapshot } from '../shared/ipc/state';

type SnapshotListener = (snapshot: FullStateSnapshot) => void;

/**
 * Owns the state that every window shares. Windows send actions; each change
 * raises the version and is passed to the subscribers, which broadcast it.
 * No Electron imports, so it can be unit-tested.
 */
export class AppStateStore {
  private state: SharedState = createInitialSharedState();
  private version = 0;
  private readonly listeners = new Set<SnapshotListener>();

  getSnapshot(): FullStateSnapshot {
    return { version: this.version, state: this.state };
  }

  /** Applies `action`. Subscribers are called only when the state changed. */
  dispatch(action: SharedAction): void {
    const next = applyAction(this.state, action);
    if (next === this.state) {
      return;
    }
    this.state = next;
    this.version += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /**
   * Replaces the whole state with one restored from storage (Phase 3c). Main
   * calls it once at launch, before any window opens; windows never can.
   */
  restore(state: SharedState): void {
    this.state = state;
    this.version += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /** Returns a function that removes the listener. */
  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
