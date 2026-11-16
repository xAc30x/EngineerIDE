import { describe, expect, it } from 'vitest';
import { AppStateStore } from '../electron/appStateStore';
import type { StateSnapshot } from '../shared/ipc/state';

describe('AppStateStore', () => {
  it('starts at version 0', () => {
    expect(new AppStateStore().getSnapshot().version).toBe(0);
  });

  it('raises the version and notifies subscribers on each change', () => {
    const store = new AppStateStore();
    const received: StateSnapshot[] = [];
    store.subscribe((snapshot) => received.push(snapshot));

    store.dispatch({ type: 'addSection', title: 'Research' });
    store.dispatch({ type: 'sendMessage', threadId: null, content: 'Hello' });

    expect(received.map((snapshot) => snapshot.version)).toEqual([1, 2]);
    expect(received[1]).toEqual(store.getSnapshot());
    expect(received[1]?.state.recents[0]?.messages[0]?.content).toBe('Hello');
  });

  it('does not raise the version or notify when an action changes nothing', () => {
    const store = new AppStateStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.dispatch({ type: 'selectThread', threadId: 'does-not-exist' });

    expect(calls).toBe(0);
    expect(store.getSnapshot().version).toBe(0);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const store = new AppStateStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.dispatch({ type: 'addSection', title: 'First' });
    unsubscribe();
    store.dispatch({ type: 'addSection', title: 'Second' });

    expect(calls).toBe(1);
  });
});
