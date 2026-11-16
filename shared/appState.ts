import { DEFAULT_BACKEND, getBackendLabel, isBackendProvider } from './backends';
import type {
  BackendProvider,
  Message,
  MessageRole,
  Section,
  SelectedFolder,
  Thread,
} from './types';

/**
 * The state every window shares, and the only functions that change it.
 * The main process owns the state (`electron/appStateStore.ts`); each window
 * holds a copy that it never edits directly.
 */

export const PINNED_SECTION_ID = 'pinned';
export const DEFAULT_THREAD_TITLE = 'New chat';
const MAX_THREAD_TITLE_LENGTH = 48;

export interface SharedState {
  /** The built-in Pinned section first, followed by user-created sections. */
  sections: Section[];
  /** Threads that are not in any section, most recent first. */
  recents: Thread[];
  /** Selected conversation, shown by both windows. */
  activeThreadId: string | null;
  activeProjectPath: string | null;
  activeProjectName: string | null;
  selectedBackend: BackendProvider;
}

/** Changes a window may request over IPC. */
export type RendererAction =
  /**
   * Starts a conversation and selects it. Without `sectionId` it goes to
   * Recents, where an existing empty conversation is reused instead of
   * adding another.
   */
  | { type: 'createThread'; sectionId?: string }
  | { type: 'selectThread'; threadId: string }
  /**
   * Adds a user message to `threadId`, the thread the sending window is
   * showing. With `null` or an unknown id a thread is created and selected.
   */
  | { type: 'sendMessage'; threadId: string | null; content: string }
  /** Moves a thread to a section, or to Recents when `sectionId` is `null`. */
  | { type: 'moveThread'; threadId: string; sectionId: string | null }
  | { type: 'togglePinned'; threadId: string }
  | { type: 'addSection'; title: string }
  /** Removes a custom section and moves its threads to Recents. */
  | { type: 'removeSection'; sectionId: string }
  | { type: 'toggleSectionCollapsed'; sectionId: string }
  | { type: 'setSelectedBackend'; backend: BackendProvider };

/**
 * Every change to the shared state. `setActiveProject` is not a
 * `RendererAction`: only the main process may dispatch it, with a folder the
 * user chose in the native dialog.
 */
export type SharedAction =
  | RendererAction
  | { type: 'setActiveProject'; folder: SelectedFolder | null };

type ThreadContainers = Pick<SharedState, 'sections' | 'recents'>;

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

export function createInitialSharedState(): SharedState {
  return {
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
  };
}

function createThread(state: SharedState, sectionId: string | undefined): SharedState {
  const targetSection =
    sectionId === undefined ? undefined : state.sections.find((section) => section.id === sectionId);

  if (targetSection === undefined) {
    const latest = state.recents[0];
    if (latest !== undefined && latest.messages.length === 0) {
      return state.activeThreadId === latest.id ? state : { ...state, activeThreadId: latest.id };
    }
    const thread = createEmptyThread();
    return { ...state, activeThreadId: thread.id, recents: [thread, ...state.recents] };
  }

  const thread = createEmptyThread();
  return {
    ...state,
    activeThreadId: thread.id,
    sections: state.sections.map((section) =>
      section.id === targetSection.id
        ? { ...section, isCollapsed: false, items: [thread, ...section.items] }
        : section,
    ),
  };
}

function sendMessage(state: SharedState, threadId: string | null, content: string): SharedState {
  const text = content.trim();
  if (text === '') {
    return state;
  }

  let base = state;
  let targetId = threadId;
  if (targetId === null || findThread(state, targetId) === undefined) {
    base = createThread(state, undefined);
    targetId = base.activeThreadId;
  }
  if (targetId === null) {
    return state;
  }

  // No AIProviderAdapter is implemented yet, so the thread records that
  // plainly instead of showing a made-up reply.
  const notice = createMessage(
    'system',
    `"${getBackendLabel(base.selectedBackend)}" is not connected yet, so no reply was generated. ` +
      'Your message is saved in this chat. AI backends arrive in a later milestone.',
  );

  return {
    ...base,
    ...updateThread(base, targetId, (thread) => ({
      ...thread,
      title: thread.messages.length === 0 ? deriveThreadTitle(text) : thread.title,
      messages: [...thread.messages, createMessage('user', text), notice],
      updatedAt: Date.now(),
    })),
  };
}

function moveThread(state: SharedState, threadId: string, sectionId: string | null): SharedState {
  const thread = findThread(state, threadId);
  if (thread === undefined) {
    return state;
  }
  if (sectionId !== null && !state.sections.some((section) => section.id === sectionId)) {
    return state;
  }

  const remaining = withoutThread(state, threadId);
  if (sectionId === null) {
    return { ...state, sections: remaining.sections, recents: [thread, ...remaining.recents] };
  }
  return {
    ...state,
    recents: remaining.recents,
    sections: remaining.sections.map((section) =>
      section.id === sectionId ? { ...section, items: [thread, ...section.items] } : section,
    ),
  };
}

function togglePinned(state: SharedState, threadId: string): SharedState {
  const pinned = state.sections.find((section) => section.id === PINNED_SECTION_ID);
  const isPinned = pinned?.items.some((thread) => thread.id === threadId) ?? false;
  return moveThread(state, threadId, isPinned ? null : PINNED_SECTION_ID);
}

function addSection(state: SharedState, title: string): SharedState {
  const trimmed = title.trim();
  if (trimmed === '') {
    return state;
  }
  return { ...state, sections: [...state.sections, createSection(trimmed, 'custom')] };
}

function removeSection(state: SharedState, sectionId: string): SharedState {
  const section = state.sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined || section.kind !== 'custom') {
    return state;
  }
  return {
    ...state,
    sections: state.sections.filter((candidate) => candidate.id !== sectionId),
    recents: [...section.items, ...state.recents],
  };
}

/**
 * Returns the state after `action`. The input is never modified; when the
 * action changes nothing, the same object is returned.
 */
export function applyAction(state: SharedState, action: SharedAction): SharedState {
  switch (action.type) {
    case 'createThread':
      return createThread(state, action.sectionId);
    case 'selectThread':
      return findThread(state, action.threadId) === undefined ||
        state.activeThreadId === action.threadId
        ? state
        : { ...state, activeThreadId: action.threadId };
    case 'sendMessage':
      return sendMessage(state, action.threadId, action.content);
    case 'moveThread':
      return moveThread(state, action.threadId, action.sectionId);
    case 'togglePinned':
      return togglePinned(state, action.threadId);
    case 'addSection':
      return addSection(state, action.title);
    case 'removeSection':
      return removeSection(state, action.sectionId);
    case 'toggleSectionCollapsed':
      return state.sections.some((section) => section.id === action.sectionId)
        ? {
            ...state,
            sections: state.sections.map((section) =>
              section.id === action.sectionId
                ? { ...section, isCollapsed: !section.isCollapsed }
                : section,
            ),
          }
        : state;
    case 'setSelectedBackend':
      return state.selectedBackend === action.backend
        ? state
        : { ...state, selectedBackend: action.backend };
    case 'setActiveProject':
      return {
        ...state,
        activeProjectPath: action.folder?.path ?? null,
        activeProjectName: action.folder?.name ?? null,
      };
  }
}

/**
 * Checks a payload that arrived over IPC. Returns a clean `RendererAction`
 * holding only the expected fields, or `null` when the payload is not one.
 */
export function parseAction(value: unknown): RendererAction | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { type, threadId, sectionId, content, title, backend } = value as Record<string, unknown>;

  switch (type) {
    case 'createThread':
      if (sectionId === undefined) {
        return { type };
      }
      return typeof sectionId === 'string' ? { type, sectionId } : null;
    case 'selectThread':
    case 'togglePinned':
      return typeof threadId === 'string' ? { type, threadId } : null;
    case 'sendMessage':
      return (threadId === null || typeof threadId === 'string') && typeof content === 'string'
        ? { type, threadId, content }
        : null;
    case 'moveThread':
      return typeof threadId === 'string' && (sectionId === null || typeof sectionId === 'string')
        ? { type, threadId, sectionId }
        : null;
    case 'addSection':
      return typeof title === 'string' ? { type, title } : null;
    case 'removeSection':
    case 'toggleSectionCollapsed':
      return typeof sectionId === 'string' ? { type, sectionId } : null;
    case 'setSelectedBackend':
      return typeof backend === 'string' && isBackendProvider(backend) ? { type, backend } : null;
    default:
      return null;
  }
}
