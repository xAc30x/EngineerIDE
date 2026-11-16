import { create } from 'zustand';
import { DEFAULT_BACKEND, getBackendLabel } from '../config/backends';
import type {
  AppMode,
  BackendProvider,
  Message,
  MessageRole,
  NavTab,
  Section,
  SelectedFolder,
  Thread,
} from '../types';

export const PINNED_SECTION_ID = 'pinned';
export const DEFAULT_THREAD_TITLE = 'New chat';
const MAX_THREAD_TITLE_LENGTH = 48;

export interface AppStateData {
  activeMode: AppMode;
  activeNavTab: NavTab;
  /** The built-in Pinned section first, followed by user-created sections. */
  sections: Section[];
  /** Threads that are not in any section, most recent first. */
  recents: Thread[];
  /** Selected conversation, shared by Workspace Mode and IDE Mode. */
  activeThreadId: string | null;
  activeProjectPath: string | null;
  activeProjectName: string | null;
  selectedBackend: BackendProvider;
  /** Unsent text in the chat input, shared by both modes. */
  composerDraft: string;
  isSidebarCollapsed: boolean;
  isArtifactsPanelOpen: boolean;
}

export interface AppActions {
  setActiveMode: (mode: AppMode) => void;
  toggleMode: () => void;
  /**
   * Opens a sidebar destination. Every tab except `chat` is a Workspace page,
   * so selecting one also switches to Workspace Mode.
   */
  setActiveNavTab: (tab: NavTab) => void;
  /**
   * Starts a conversation and selects it. Without `sectionId` it goes to
   * Recents, where an existing empty conversation is reused instead of
   * adding another. Returns the id of the selected thread.
   */
  createThread: (sectionId?: string) => string;
  selectThread: (threadId: string) => void;
  /** Adds a user message to the active thread, creating a thread if needed. */
  sendMessage: (content: string) => void;
  /** Moves a thread to a section, or to Recents when `sectionId` is `null`. */
  moveThread: (threadId: string, sectionId: string | null) => void;
  togglePinned: (threadId: string) => void;
  /** Returns the new section id, or `null` when the title is blank. */
  addSection: (title: string) => string | null;
  /** Removes a custom section and moves its threads to Recents. */
  removeSection: (sectionId: string) => void;
  toggleSectionCollapsed: (sectionId: string) => void;
  setActiveProject: (folder: SelectedFolder | null) => void;
  setSelectedBackend: (backend: BackendProvider) => void;
  setComposerDraft: (draft: string) => void;
  toggleSidebar: () => void;
  toggleArtifactsPanel: () => void;
}

export type AppStore = AppStateData & AppActions;

type ThreadContainers = Pick<AppStateData, 'sections' | 'recents'>;

function createId(): string {
  return crypto.randomUUID();
}

function createSection(title: string, kind: Section['kind'], id: string = createId()): Section {
  return { id, title, kind, isCollapsed: false, items: [] };
}

function createEmptyThread(): Thread {
  const now = Date.now();
  return { id: createId(), title: DEFAULT_THREAD_TITLE, messages: [], createdAt: now, updatedAt: now };
}

function createMessage(role: MessageRole, content: string): Message {
  return { id: createId(), role, content, createdAt: Date.now() };
}

function deriveThreadTitle(firstMessage: string): string {
  const firstLine = firstMessage.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine === '') {
    return DEFAULT_THREAD_TITLE;
  }
  return firstLine.length > MAX_THREAD_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_THREAD_TITLE_LENGTH - 1)}…`
    : firstLine;
}

export function findThread(state: ThreadContainers, threadId: string): Thread | undefined {
  for (const section of state.sections) {
    const match = section.items.find((thread) => thread.id === threadId);
    if (match) {
      return match;
    }
  }
  return state.recents.find((thread) => thread.id === threadId);
}

function updateThread(
  state: ThreadContainers,
  threadId: string,
  update: (thread: Thread) => Thread,
): ThreadContainers {
  const apply = (threads: Thread[]): Thread[] =>
    threads.map((thread) => (thread.id === threadId ? update(thread) : thread));
  return {
    sections: state.sections.map((section) => ({ ...section, items: apply(section.items) })),
    recents: apply(state.recents),
  };
}

function withoutThread(state: ThreadContainers, threadId: string): ThreadContainers {
  const remove = (threads: Thread[]): Thread[] => threads.filter((thread) => thread.id !== threadId);
  return {
    sections: state.sections.map((section) => ({ ...section, items: remove(section.items) })),
    recents: remove(state.recents),
  };
}

export function createInitialState(): AppStateData {
  return {
    activeMode: 'workspace',
    activeNavTab: 'chat',
    sections: [
      createSection('Pinned', 'pinned', PINNED_SECTION_ID),
      createSection('Work', 'custom'),
      createSection('Personal', 'custom'),
    ],
    recents: [],
    activeThreadId: null,
    activeProjectPath: null,
    activeProjectName: null,
    selectedBackend: DEFAULT_BACKEND,
    composerDraft: '',
    isSidebarCollapsed: false,
    isArtifactsPanelOpen: false,
  };
}

/** The selected conversation, or `undefined` when none is selected. */
export function selectActiveThread(state: AppStore): Thread | undefined {
  return state.activeThreadId === null ? undefined : findThread(state, state.activeThreadId);
}

export const useAppStore = create<AppStore>()((set, get) => ({
  ...createInitialState(),

  setActiveMode: (mode) => set({ activeMode: mode }),

  toggleMode: () =>
    set((state) => ({ activeMode: state.activeMode === 'workspace' ? 'ide' : 'workspace' })),

  setActiveNavTab: (tab) =>
    set((state) => ({
      activeNavTab: tab,
      activeMode: tab === 'chat' ? state.activeMode : 'workspace',
    })),

  createThread: (sectionId) => {
    const state = get();
    const targetSection =
      sectionId === undefined
        ? undefined
        : state.sections.find((section) => section.id === sectionId);

    if (targetSection === undefined) {
      const latest = state.recents[0];
      if (latest !== undefined && latest.messages.length === 0) {
        set({ activeThreadId: latest.id, activeNavTab: 'chat' });
        return latest.id;
      }
    }

    const thread = createEmptyThread();
    set({
      activeThreadId: thread.id,
      activeNavTab: 'chat',
      ...(targetSection === undefined
        ? { recents: [thread, ...state.recents] }
        : {
            sections: state.sections.map((section) =>
              section.id === targetSection.id
                ? { ...section, isCollapsed: false, items: [thread, ...section.items] }
                : section,
            ),
          }),
    });
    return thread.id;
  },

  selectThread: (threadId) => {
    if (findThread(get(), threadId) === undefined) {
      return;
    }
    set({ activeThreadId: threadId, activeNavTab: 'chat' });
  },

  sendMessage: (content) => {
    const text = content.trim();
    if (text === '') {
      return;
    }

    const activeId = get().activeThreadId;
    const threadId =
      activeId !== null && findThread(get(), activeId) !== undefined
        ? activeId
        : get().createThread();

    // No AIProviderAdapter is implemented in Milestone 1, so the thread
    // records that plainly instead of showing a made-up reply.
    const backendLabel = getBackendLabel(get().selectedBackend);
    const notice = createMessage(
      'system',
      `"${backendLabel}" is not connected yet, so no reply was generated. ` +
        'Your message is saved in this chat. AI backends arrive in a later milestone.',
    );

    set((state) => ({
      ...updateThread(state, threadId, (thread) => ({
        ...thread,
        title: thread.messages.length === 0 ? deriveThreadTitle(text) : thread.title,
        messages: [...thread.messages, createMessage('user', text), notice],
        updatedAt: Date.now(),
      })),
      activeThreadId: threadId,
    }));
  },

  moveThread: (threadId, sectionId) => {
    const state = get();
    const thread = findThread(state, threadId);
    if (thread === undefined) {
      return;
    }
    if (sectionId !== null && !state.sections.some((section) => section.id === sectionId)) {
      return;
    }

    const remaining = withoutThread(state, threadId);
    set(
      sectionId === null
        ? { sections: remaining.sections, recents: [thread, ...remaining.recents] }
        : {
            recents: remaining.recents,
            sections: remaining.sections.map((section) =>
              section.id === sectionId ? { ...section, items: [thread, ...section.items] } : section,
            ),
          },
    );
  },

  togglePinned: (threadId) => {
    const pinned = get().sections.find((section) => section.id === PINNED_SECTION_ID);
    const isPinned = pinned?.items.some((thread) => thread.id === threadId) ?? false;
    get().moveThread(threadId, isPinned ? null : PINNED_SECTION_ID);
  },

  addSection: (title) => {
    const trimmed = title.trim();
    if (trimmed === '') {
      return null;
    }
    const section = createSection(trimmed, 'custom');
    set((state) => ({ sections: [...state.sections, section] }));
    return section.id;
  },

  removeSection: (sectionId) =>
    set((state) => {
      const section = state.sections.find((candidate) => candidate.id === sectionId);
      if (section === undefined || section.kind !== 'custom') {
        return state;
      }
      return {
        sections: state.sections.filter((candidate) => candidate.id !== sectionId),
        recents: [...section.items, ...state.recents],
      };
    }),

  toggleSectionCollapsed: (sectionId) =>
    set((state) => ({
      sections: state.sections.map((section) =>
        section.id === sectionId ? { ...section, isCollapsed: !section.isCollapsed } : section,
      ),
    })),

  setActiveProject: (folder) =>
    set({ activeProjectPath: folder?.path ?? null, activeProjectName: folder?.name ?? null }),

  setSelectedBackend: (backend) => set({ selectedBackend: backend }),

  setComposerDraft: (draft) => set({ composerDraft: draft }),

  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  toggleArtifactsPanel: () =>
    set((state) => ({ isArtifactsPanelOpen: !state.isArtifactsPanelOpen })),
}));
