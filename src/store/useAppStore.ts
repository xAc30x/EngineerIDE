import { create } from 'zustand';
import {
  applyAction,
  createInitialSharedState,
  findThread,
  type RendererAction,
  type SharedState,
} from '../../shared/appState';
import type { StateApi, StateSnapshot } from '../../shared/ipc/state';
import { getBridge } from '../lib/bridge';
import type { BackendProvider, NavTab, Thread } from '../types';

export { DEFAULT_THREAD_TITLE, findThread, PINNED_SECTION_ID } from '../../shared/appState';

/** UI state that belongs to one window and is never synchronised. */
export interface WindowLocalState {
  /** The open Workspace page. */
  activeNavTab: NavTab;
  /** Unsent text in this window's chat input. */
  composerDraft: string;
  isSidebarCollapsed: boolean;
  isArtifactsPanelOpen: boolean;
}

/** This window's copy of the shared state, plus its own UI state. */
export type AppStateData = SharedState & WindowLocalState;

/**
 * Shared-state actions are requests: with a bridge they go to the main
 * process and take effect when its next snapshot arrives. They return nothing.
 */
export interface AppActions {
  setActiveNavTab: (tab: NavTab) => void;
  /**
   * Starts a conversation and selects it. Without `sectionId` it goes to
   * Recents, where an existing empty conversation is reused.
   */
  createThread: (sectionId?: string) => void;
  selectThread: (threadId: string) => void;
  /** Adds a user message to the thread this window is showing. */
  sendMessage: (content: string) => void;
  /** Moves a thread to a section, or to Recents when `sectionId` is `null`. */
  moveThread: (threadId: string, sectionId: string | null) => void;
  togglePinned: (threadId: string) => void;
  addSection: (title: string) => void;
  /** Removes a custom section and moves its threads to Recents. */
  removeSection: (sectionId: string) => void;
  toggleSectionCollapsed: (sectionId: string) => void;
  setSelectedBackend: (backend: BackendProvider) => void;
  setComposerDraft: (draft: string) => void;
  toggleSidebar: () => void;
  toggleArtifactsPanel: () => void;
}

export type AppStore = AppStateData & AppActions;

export function createInitialState(): AppStateData {
  return {
    ...createInitialSharedState(),
    activeNavTab: 'chat',
    composerDraft: '',
    isSidebarCollapsed: false,
    isArtifactsPanelOpen: false,
  };
}

function pickSharedState(state: AppStateData): SharedState {
  return {
    sections: state.sections,
    recents: state.recents,
    activeThreadId: state.activeThreadId,
    activeProjectPath: state.activeProjectPath,
    activeProjectName: state.activeProjectName,
    selectedBackend: state.selectedBackend,
  };
}

/** The selected conversation, or `undefined` when none is selected. */
export function selectActiveThread(state: AppStore): Thread | undefined {
  return state.activeThreadId === null ? undefined : findThread(state, state.activeThreadId);
}

/**
 * Creates one window's store.
 *
 * With `bridge`, the shared part mirrors the main process: actions are sent
 * to it and the store changes when a snapshot comes back. Without a bridge
 * (a regular browser, or a unit test) actions are applied locally.
 */
export function createAppStore(bridge?: StateApi) {
  const store = create<AppStore>()((set, get) => {
    const dispatch = (action: RendererAction): void => {
      if (bridge === undefined) {
        set(applyAction(pickSharedState(get()), action));
        return;
      }
      bridge
        .dispatch(action)
        .then((result) => {
          if (!result.ok) {
            console.error(`The "${action.type}" change was rejected: ${result.error}`);
          }
        })
        .catch((error: unknown) => {
          console.error(`The "${action.type}" change could not be sent:`, error);
        });
    };

    return {
      ...createInitialState(),

      setActiveNavTab: (tab) => set({ activeNavTab: tab }),

      createThread: (sectionId) => {
        set({ activeNavTab: 'chat' });
        dispatch(sectionId === undefined ? { type: 'createThread' } : { type: 'createThread', sectionId });
      },

      selectThread: (threadId) => {
        if (findThread(get(), threadId) === undefined) {
          return;
        }
        set({ activeNavTab: 'chat' });
        dispatch({ type: 'selectThread', threadId });
      },

      // The thread id is sent along, so the message lands in the thread this
      // window shows even if the other window changes the selection meanwhile.
      sendMessage: (content) =>
        dispatch({ type: 'sendMessage', threadId: get().activeThreadId, content }),

      moveThread: (threadId, sectionId) => dispatch({ type: 'moveThread', threadId, sectionId }),
      togglePinned: (threadId) => dispatch({ type: 'togglePinned', threadId }),
      addSection: (title) => dispatch({ type: 'addSection', title }),
      removeSection: (sectionId) => dispatch({ type: 'removeSection', sectionId }),
      toggleSectionCollapsed: (sectionId) => dispatch({ type: 'toggleSectionCollapsed', sectionId }),
      setSelectedBackend: (backend) => dispatch({ type: 'setSelectedBackend', backend }),

      setComposerDraft: (draft) => set({ composerDraft: draft }),
      toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      toggleArtifactsPanel: () =>
        set((state) => ({ isArtifactsPanelOpen: !state.isArtifactsPanelOpen })),
    };
  });

  if (bridge !== undefined) {
    // Snapshots can arrive out of order (the first fetch races with
    // broadcasts), so anything that is not newer than the current one is dropped.
    let version = -1;
    const applySnapshot = (snapshot: StateSnapshot): void => {
      if (snapshot.version <= version) {
        return;
      }
      version = snapshot.version;
      store.setState(snapshot.state);
    };

    // Subscribe first, then fetch, so no change can fall between the two.
    bridge.onStateChanged(applySnapshot);
    bridge
      .getAppState()
      .then((result) => {
        if (result.ok) {
          applySnapshot(result.value);
        } else {
          console.error(`Could not load the application state: ${result.error}`);
        }
      })
      .catch((error: unknown) => {
        console.error('Could not load the application state:', error);
      });
  }

  return store;
}

/** The store of the window this page runs in. */
export const useAppStore = createAppStore(getBridge());
