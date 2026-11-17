import { BACKEND_OPTIONS } from '../../shared/backends';
import { formatShortcut } from '../lib/platform';
import { otherWindowKind } from '../lib/windowKind';
import type { BackendProvider, NavTab, WindowKind } from '../types';
import { NAV_TAB_LABELS } from './navigation';

/**
 * What a command acts through. The palette passes in store actions and the
 * bridge helpers from `src/lib/`, so this file stays pure and unit-testable.
 */
export interface CommandHelpers {
  /** The window the palette is open in. */
  windowKind: WindowKind;
  showWindow: (kind: WindowKind) => void;
  /** Opens the native folder dialog; the choice becomes the project in every window. */
  selectFolder: () => Promise<void>;
  createThread: (sectionId?: string) => void;
  toggleSidebar: () => void;
  toggleArtifactsPanel: () => void;
  setActiveNavTab: (tab: NavTab) => void;
  setSelectedBackend: (backend: BackendProvider) => void;
  closePalette: () => void;
}

export type CommandCategory = 'Navigation' | 'Chat & AI' | 'Project' | 'Layout';

export const COMMAND_CATEGORIES: readonly CommandCategory[] = ['Navigation', 'Chat & AI', 'Project', 'Layout'];

export const WINDOW_KINDS: readonly WindowKind[] = ['workspace', 'ide'];

export interface CommandItem {
  /** Stable, unique id in kebab case, for example `nav-workspace-chat`. */
  id: string;
  title: string;
  category: CommandCategory;
  /** Display label of the command's own shortcut, if it has one. */
  shortcut?: string;
  /** Extra words the search matches, for example `model` or `backend`. */
  keywords?: string[];
  /** Windows that offer this command. Left out: every window. */
  windows?: WindowKind[];
  /** True when the command needs the desktop app (other window, native dialogs). */
  requiresDesktop?: boolean;
  /** For model commands: the backend they select, so the palette can tick the current one. */
  backend?: BackendProvider;
  action: (helpers: CommandHelpers) => void | Promise<void>;
}

const NAV_TABS: readonly NavTab[] = ['chat', 'projects', 'artifacts', 'scheduled', 'design', 'settings'];

export const COMMAND_REGISTRY: readonly CommandItem[] = [
  {
    id: 'nav-toggle-window',
    title: 'Toggle IDE / Workspace Window',
    category: 'Navigation',
    shortcut: formatShortcut('E'),
    keywords: ['switch', 'mode', 'editor', 'chat'],
    requiresDesktop: true,
    action: ({ windowKind, showWindow, closePalette }) => {
      closePalette();
      showWindow(otherWindowKind(windowKind));
    },
  },
  ...NAV_TABS.map(
    (tab): CommandItem => ({
      id: `nav-workspace-${tab}`,
      title: `Go to ${NAV_TAB_LABELS[tab]} View`,
      category: 'Navigation',
      keywords: ['page', 'open'],
      windows: ['workspace'],
      action: ({ setActiveNavTab, closePalette }) => {
        setActiveNavTab(tab);
        closePalette();
      },
    }),
  ),
  {
    id: 'chat-new-thread',
    title: 'New Chat Thread',
    category: 'Chat & AI',
    keywords: ['create', 'conversation', 'prompt'],
    windows: ['workspace'],
    action: ({ createThread, closePalette }) => {
      createThread();
      closePalette();
    },
  },
  ...BACKEND_OPTIONS.map(
    (option): CommandItem => ({
      id: `ai-select-${option.id}`,
      title: `Switch AI Backend to ${option.label}`,
      category: 'Chat & AI',
      keywords: ['model', 'backend', 'provider'],
      backend: option.id,
      action: ({ setSelectedBackend, closePalette }) => {
        setSelectedBackend(option.id);
        closePalette();
      },
    }),
  ),
  {
    id: 'project-open-folder',
    title: 'Open Project Folder…',
    category: 'Project',
    keywords: ['directory', 'workspace', 'select'],
    requiresDesktop: true,
    action: async ({ selectFolder, closePalette }) => {
      closePalette();
      await selectFolder();
    },
  },
  {
    id: 'layout-toggle-sidebar',
    title: 'Toggle Sidebar',
    category: 'Layout',
    shortcut: formatShortcut('B'),
    windows: ['workspace'],
    action: ({ toggleSidebar, closePalette }) => {
      toggleSidebar();
      closePalette();
    },
  },
  {
    id: 'layout-toggle-artifacts',
    title: 'Toggle Artifacts Split Pane',
    category: 'Layout',
    windows: ['workspace'],
    action: ({ toggleArtifactsPanel, closePalette }) => {
      toggleArtifactsPanel();
      closePalette();
    },
  },
];

/**
 * The registry commands this window offers, in registry order. A command is
 * left out when its `windows` list doesn't include `windowKind`, or when it
 * needs the desktop app and `isDesktop` is false.
 */
export function commandsForWindow(
  registry: readonly CommandItem[],
  windowKind: WindowKind,
  isDesktop: boolean,
): CommandItem[] {
  return registry.filter(
    (command) =>
      (command.windows === undefined || command.windows.includes(windowKind)) &&
      (command.requiresDesktop !== true || isDesktop),
  );
}

/**
 * The commands matching `query`, best first. Every word of the query must
 * appear in the title, category or keywords (case-insensitive). Commands whose
 * title starts with the query come first; otherwise the list order is kept.
 */
export function filterCommands(commands: readonly CommandItem[], query: string): CommandItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [...commands];
  }
  const needle = words.join(' ');
  const matches = commands.filter((command) => {
    const haystack = [command.title, command.category, ...(command.keywords ?? [])].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  // `sort` is stable, so equal ranks keep their list order.
  const rank = (command: CommandItem): number => (command.title.toLowerCase().startsWith(needle) ? 0 : 1);
  return matches.sort((a, b) => rank(a) - rank(b));
}

/**
 * Moves the highlighted row by `delta`, wrapping around at both ends.
 * Returns 0 for an empty list.
 */
export function cycleIndex(index: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}
