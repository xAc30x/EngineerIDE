import { describe, expect, it } from 'vitest';
import { AppStateStore } from '../electron/appStateStore';
import { readThreadMessages } from '../electron/threadMessages';
import { createInitialSharedState, toIndexState } from '../shared/appState';
import { toStateSnapshot, type StateSnapshot } from '../shared/ipc/state';
import {
  createAppStore,
  findThread,
  selectActiveThread,
  type WindowBridge,
} from '../src/store/useAppStore';

/** Lets pending promise callbacks (for example the first state fetch) run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The bridge one window would get from the preload script, wired to `main`
 * directly. Like the real IPC handlers, it sends the thread index and answers
 * message fetches from main's full state (Phase 3c).
 */
function connectWindow(main: AppStateStore): WindowBridge {
  return {
    getAppState: async () => ({ ok: true, value: toStateSnapshot(main.getSnapshot()) }),
    dispatch: async (action) => {
      main.dispatch(action);
      return { ok: true, value: null };
    },
    onStateChanged: (listener) => main.subscribe((snapshot) => listener(toStateSnapshot(snapshot))),
    getThreadMessages: async (threadId) => readThreadMessages(main.getSnapshot().state, threadId),
  };
}

/** The message texts a window gets when it fetches its active thread. */
async function activeContents(store: ReturnType<typeof createAppStore>): Promise<string[]> {
  const id = store.getState().activeThreadId;
  if (id === null) return [];
  const result = await store.getState().loadThreadMessages(id);
  return result.ok ? result.value.map((message) => message.content) : [];
}

/** A bridge whose broadcasts are held back until `deliver()` is called. */
function connectSlowWindow(main: AppStateStore): { bridge: WindowBridge; deliver: () => void } {
  const pending: StateSnapshot[] = [];
  let listener: ((snapshot: StateSnapshot) => void) | undefined;
  main.subscribe((snapshot) => pending.push(toStateSnapshot(snapshot)));
  return {
    bridge: {
      ...connectWindow(main),
      onStateChanged: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    deliver: () => {
      for (const snapshot of pending.splice(0)) {
        listener?.(snapshot);
      }
    },
  };
}

function activeThreadId(store: ReturnType<typeof createAppStore>): string {
  const id = store.getState().activeThreadId;
  if (id === null) {
    throw new Error('Expected an active thread.');
  }
  return id;
}

describe('window-local state', () => {
  it('starts on the chat page with an empty draft and both panels in their default state', () => {
    const store = createAppStore();
    expect(store.getState()).toMatchObject({
      activeNavTab: 'chat',
      composerDraft: '',
      isSidebarCollapsed: false,
      isArtifactsPanelOpen: false,
    });
  });

  it('opens the chat page when a thread is created or selected', () => {
    const store = createAppStore();
    store.getState().setActiveNavTab('scheduled');
    store.getState().createThread();
    expect(store.getState().activeNavTab).toBe('chat');

    store.getState().setActiveNavTab('projects');
    store.getState().selectThread(activeThreadId(store));
    expect(store.getState().activeNavTab).toBe('chat');
  });

  it('stays on the current page when an unknown thread is selected', () => {
    const store = createAppStore();
    store.getState().setActiveNavTab('projects');
    store.getState().selectThread('does-not-exist');
    expect(store.getState().activeNavTab).toBe('projects');
  });

  it('toggles the sidebar and the artifacts panel', () => {
    const store = createAppStore();
    store.getState().toggleSidebar();
    store.getState().toggleArtifactsPanel();
    expect(store.getState().isSidebarCollapsed).toBe(true);
    expect(store.getState().isArtifactsPanelOpen).toBe(true);
  });
});

describe('without a bridge', () => {
  it('applies actions locally, and serves the messages itself', async () => {
    const store = createAppStore();
    store.getState().sendMessage('Hello');
    store.getState().setSelectedBackend('openrouter');
    expect(selectActiveThread(store.getState())?.messageCount).toBe(1);
    expect(await activeContents(store)).toEqual(['Hello']);
    expect(store.getState().selectedBackend).toBe('openrouter');
  });
});

describe('two windows on one main process', () => {
  it('loads the current state into a window that opens later', async () => {
    const main = new AppStateStore();
    const workspace = createAppStore(connectWindow(main));
    workspace.getState().sendMessage('Written before the IDE window opened');

    const ide = createAppStore(connectWindow(main));
    await flush();

    expect(ide.getState().activeThreadId).toBe(activeThreadId(workspace));
    expect(await activeContents(ide)).toEqual(['Written before the IDE window opened']);
  });

  it('shows a message sent in either window in the other', async () => {
    const main = new AppStateStore();
    const workspace = createAppStore(connectWindow(main));
    const ide = createAppStore(connectWindow(main));
    await flush();

    workspace.getState().sendMessage('From the Workspace window');
    ide.getState().sendMessage('From the IDE window');

    expect(await activeContents(workspace)).toEqual([
      'From the Workspace window',
      'From the IDE window',
    ]);
    expect(await activeContents(ide)).toEqual(await activeContents(workspace));
    expect(selectActiveThread(ide.getState())?.messageCount).toBe(2);
  });

  it('never receives a message body in a snapshot (Phase 3c)', async () => {
    const main = new AppStateStore();
    const received: StateSnapshot[] = [];
    const bridge = connectWindow(main);
    bridge.onStateChanged((snapshot) => received.push(snapshot));
    const workspace = createAppStore(bridge);
    await flush();

    workspace.getState().sendMessage('Title line');
    workspace.getState().sendMessage('a private second message');

    // The title comes from the first message, so look for the second one.
    expect(JSON.stringify(received)).not.toContain('a private second message');
    expect(JSON.stringify(workspace.getState())).not.toContain('a private second message');
    expect(await activeContents(workspace)).toEqual(['Title line', 'a private second message']);
  });

  it('keeps the same active thread in both windows', async () => {
    const main = new AppStateStore();
    const workspace = createAppStore(connectWindow(main));
    const ide = createAppStore(connectWindow(main));
    await flush();

    workspace.getState().sendMessage('First thread');
    const first = activeThreadId(workspace);
    workspace.getState().createThread();
    expect(activeThreadId(ide)).toBe(activeThreadId(workspace));
    expect(activeThreadId(ide)).not.toBe(first);

    workspace.getState().selectThread(first);
    expect(activeThreadId(ide)).toBe(first);
  });

  it('shows a project folder chosen through the main process in both windows', async () => {
    const main = new AppStateStore();
    const workspace = createAppStore(connectWindow(main));
    const ide = createAppStore(connectWindow(main));
    await flush();

    main.dispatch({ type: 'setActiveProject', folder: { path: 'project-path', name: 'project' } });

    for (const store of [workspace, ide]) {
      expect(store.getState().activeProjectPath).toBe('project-path');
      expect(store.getState().activeProjectName).toBe('project');
    }
  });

  it('keeps the draft, the open page, and the panel toggles separate per window', async () => {
    const main = new AppStateStore();
    const workspace = createAppStore(connectWindow(main));
    const ide = createAppStore(connectWindow(main));
    await flush();

    workspace.getState().setComposerDraft('Half-written');
    workspace.getState().setActiveNavTab('projects');
    workspace.getState().toggleSidebar();
    // A shared change must not reset the other window's local state either.
    ide.getState().sendMessage('Hello');

    expect(workspace.getState()).toMatchObject({
      composerDraft: 'Half-written',
      activeNavTab: 'projects',
      isSidebarCollapsed: true,
    });
    expect(ide.getState()).toMatchObject({
      composerDraft: '',
      activeNavTab: 'chat',
      isSidebarCollapsed: false,
    });
  });

  it('sends a message to the thread the sending window shows, even if the selection has moved on', async () => {
    const main = new AppStateStore();
    const workspace = createAppStore(connectWindow(main));
    const slow = connectSlowWindow(main);
    const ide = createAppStore(slow.bridge);

    workspace.getState().sendMessage('First thread');
    const first = activeThreadId(workspace);
    slow.deliver();
    await flush();
    expect(activeThreadId(ide)).toBe(first);

    // The Workspace window moves to a new thread; the IDE window has not heard yet.
    workspace.getState().createThread();
    const second = activeThreadId(workspace);
    ide.getState().sendMessage('Typed while looking at the first thread');
    slow.deliver();

    const state = main.getSnapshot().state;
    expect(findThread(state, first)?.messages.map((message) => message.content)).toContain(
      'Typed while looking at the first thread',
    );
    expect(findThread(state, second)?.messages).toEqual([]);
  });
});

describe('snapshot ordering', () => {
  function connectManually(firstFetch: StateSnapshot) {
    let listener: ((snapshot: StateSnapshot) => void) | undefined;
    const bridge: WindowBridge = {
      getThreadMessages: async () => ({ ok: true, value: [] }),
      getAppState: async () => ({ ok: true, value: firstFetch }),
      dispatch: async () => ({ ok: true, value: null }),
      onStateChanged: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    const store = createAppStore(bridge);
    return { store, broadcast: (snapshot: StateSnapshot) => listener?.(snapshot) };
  }

  function snapshot(version: number, projectName: string): StateSnapshot {
    return {
      version,
      state: { ...toIndexState(createInitialSharedState()), activeProjectName: projectName },
    };
  }

  it('ignores a first fetch that is older than a broadcast it already applied', async () => {
    const { store, broadcast } = connectManually(snapshot(3, 'older'));
    broadcast(snapshot(4, 'newer'));
    await flush();
    expect(store.getState().activeProjectName).toBe('newer');
  });

  it('ignores a broadcast that is not newer than the current snapshot', async () => {
    const { store, broadcast } = connectManually(snapshot(5, 'current'));
    await flush();
    broadcast(snapshot(5, 'duplicate'));
    broadcast(snapshot(2, 'stale'));
    expect(store.getState().activeProjectName).toBe('current');

    broadcast(snapshot(6, 'next'));
    expect(store.getState().activeProjectName).toBe('next');
  });
});
