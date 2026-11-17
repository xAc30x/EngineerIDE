import { isBackendProvider } from '../../shared/backends';
import {
  createInitialSharedState,
  findThread,
  PINNED_SECTION_ID,
  type SharedState,
} from '../../shared/appState';
import type { Section, Thread } from '../../shared/types';
import type { StoredData, StoredMessage, StoredThread } from './protocol';

/**
 * Turns what the database holds into the state the app starts with (Phase
 * 3c). Pure, so it is unit-tested without a database.
 */

export interface RestoredState {
  /** The state the app starts with. Its active project is always unset. */
  state: SharedState;
  /**
   * The same state as it is in the database, before anything was added at
   * launch (the built-in sections of a new database). The writer starts from
   * it, so what was added gets saved.
   */
  saved: SharedState;
  /** The last project, which main approves again before it is used. */
  projectPath: string | null;
}

/** Recents and each section, newest first among threads with the same place. */
function byPlace(a: StoredThread, b: StoredThread): number {
  return a.position - b.position || b.updatedAt - a.updatedAt;
}

/** Messages read from the database, as the shared state holds them. */
export function toMessages(stored: StoredMessage[]): Thread['messages'] {
  return stored.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
}

export function buildRestoredState(data: StoredData): RestoredState {
  const defaults = createInitialSharedState();

  const savedSections: Section[] = data.sections.map(({ position: _position, ...section }) => ({
    ...section,
    items: [],
  }));
  const sectionsById = new Map(savedSections.map((section) => [section.id, section]));

  const recents: Thread[] = [];
  for (const stored of [...data.threads].sort(byPlace)) {
    const thread: Thread = {
      id: stored.id,
      title: stored.title,
      // Messages stay in the database until main first needs them.
      messages: [],
      messageCount: stored.messageCount,
      messagesLoaded: stored.messageCount === 0,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      // A reply never survives a restart.
      runningReply: null,
    };
    // A thread whose section is gone goes to Recents.
    const section = stored.sectionId === null ? undefined : sectionsById.get(stored.sectionId);
    (section?.items ?? recents).push(thread);
  }

  // A new database gets the built-in sections; the Pinned section always exists.
  let sections = savedSections;
  if (sections.length === 0) {
    sections = defaults.sections;
  } else if (!sections.some((section) => section.id === PINNED_SECTION_ID)) {
    const pinned = defaults.sections.find((section) => section.id === PINNED_SECTION_ID);
    sections = pinned === undefined ? sections : [pinned, ...sections];
  }

  const containers = { sections, recents };
  const storedThreadId = data.settings.activeThreadId;
  const activeThreadId =
    storedThreadId !== undefined && findThread(containers, storedThreadId) !== undefined
      ? storedThreadId
      : null;
  const storedBackend = data.settings.selectedBackend;
  const selectedBackend =
    storedBackend !== undefined && isBackendProvider(storedBackend)
      ? storedBackend
      : defaults.selectedBackend;
  const projectPath = data.settings.activeProjectPath ?? null;

  const state: SharedState = {
    ...defaults,
    sections,
    recents,
    activeThreadId,
    selectedBackend,
  };
  const saved: SharedState = {
    ...state,
    sections: savedSections,
    activeThreadId: storedThreadId ?? null,
    activeProjectPath: projectPath,
  };
  return { state, saved, projectPath };
}
