import { describe, expect, it } from 'vitest';
import {
  carriesThread,
  droppedThreadId,
  moveTargets,
  THREAD_DRAG_TYPE,
} from '../src/components/sidebar/moveThread';
import { createAppStore } from '../src/store/useAppStore';

/** Moving a chat between sections from the sidebar (after Phase 3c). */

const SECTIONS = [
  { id: 'pinned', title: 'Pinned' },
  { id: 'work', title: 'Work' },
  { id: 'personal', title: 'Personal' },
];

describe('moveTargets', () => {
  it('offers every section and Recents, but not where the chat already is', () => {
    expect(moveTargets(SECTIONS, 'work')).toEqual([
      { id: 'pinned', label: 'Pinned' },
      { id: 'personal', label: 'Personal' },
      { id: null, label: 'Recents' },
    ]);
  });

  it('does not offer Recents to a chat already in Recents', () => {
    expect(moveTargets(SECTIONS, null).map((target) => target.id)).toEqual([
      'pinned',
      'work',
      'personal',
    ]);
  });
});

describe('drag data', () => {
  it('accepts only drags that carry a chat', () => {
    expect(carriesThread(['text/plain', THREAD_DRAG_TYPE])).toBe(true);
    expect(carriesThread(['text/plain', 'Files'])).toBe(false);
  });

  it('reads the chat id from a drop', () => {
    const data: Record<string, string> = { [THREAD_DRAG_TYPE]: 't1' };
    expect(droppedThreadId((type) => data[type] ?? '')).toBe('t1');
    expect(droppedThreadId(() => '')).toBeNull();
  });
});

describe('moving through the window store', () => {
  it('moves a chat into a section, and back to Recents', () => {
    const store = createAppStore();
    store.getState().sendMessage('Hello');
    const threadId = store.getState().activeThreadId ?? '';
    const work = store.getState().sections[1]?.id ?? '';

    store.getState().moveThread(threadId, work);
    expect(store.getState().sections[1]?.items.map((thread) => thread.id)).toEqual([threadId]);
    expect(store.getState().recents).toEqual([]);

    store.getState().moveThread(threadId, null);
    expect(store.getState().recents.map((thread) => thread.id)).toEqual([threadId]);
  });
});
