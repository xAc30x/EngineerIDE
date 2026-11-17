import { BACKEND_OPTIONS } from '../../shared/backends';
import { formatShortcut } from '../lib/platform';
import type { BackendProvider, NavTab, WindowKind } from '../types';
import { NAV_TAB_LABELS } from './navigation';

/**
 * What the commands act through. The palette passes in store actions and the
 * bridge helpers from `src/lib/`, so this file stays pure and unit-testable.
 */
export interface CommandHelpers {
  showWindow: (kind: WindowKind) => void;
  /** Opens the native folder dialog; the choice becomes the project in every window. */
  selectFolder: () => Promise<void>;
  setActiveNavTab: (tab: NavTab) => void;
  createThread: () => void;
  toggleSidebar: () => void;
  toggleArtifactsPanel: () => void;
  setSelectedBackend: (backend: BackendProvider) => void;
}

/** Facts about the window the palette is open in, read when it opens. */
export interface CommandContext {
  windowKind: WindowKind;
  /** False outside the desktop app, where windows and folders are unavailable. */
  isDesktop: boolean;
  selectedBackend: BackendProvider;
  isSidebarCollapsed: boolean;
  isArtifactsPanelOpen: boolean;
}

export type CommandGroup = 'Go to' | 'Chat' | 'View' | 'Window' | 'AI model' | 'Project';

export interface Command {
  /** Stable id, for example `nav.settings` or `model.openrouter`. */
  id: string;
  group: CommandGroup;
  title: string;
  /** Extra words the search matches, for example `model` or `backend`. */
  keywords?: readonly string[];
  /** Display label of the command's own shortcut, if it has one. */
  shortcut?: string;
  /** True for the option that is already in effect, such as the selected model. */
  isCurrent?: boolean;
  run: () => void | Promise<void>;
}

const NAV_TABS: readonly NavTab[] = ['chat', 'projects', 'artifacts', 'scheduled', 'design', 'settings'];

/**
 * The commands offered in one window. The IDE window has no sidebar or pages,
 * so it gets only the window, model and project commands.
 */
export function buildCommands(helpers: CommandHelpers, context: CommandContext): Command[] {
  const commands: Command[] = [];
  const isWorkspace = context.windowKind === 'workspace';

  if (isWorkspace) {
    commands.push({
      id: 'chat.new',
      group: 'Chat',
      title: 'New chat',
      keywords: ['thread', 'conversation', 'create'],
      run: () => helpers.createThread(),
    });
    for (const tab of NAV_TABS) {
      commands.push({
        id: `nav.${tab}`,
        group: 'Go to',
        title: `Go to ${NAV_TAB_LABELS[tab]}`,
        keywords: ['page', 'open', 'navigate'],
        run: () => helpers.setActiveNavTab(tab),
      });
    }
    commands.push(
      {
        id: 'view.sidebar',
        group: 'View',
        title: context.isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
        keywords: ['toggle', 'panel'],
        shortcut: formatShortcut('B'),
        run: () => helpers.toggleSidebar(),
      },
      {
        id: 'view.artifacts',
        group: 'View',
        title: context.isArtifactsPanelOpen ? 'Hide artifacts panel' : 'Show artifacts panel',
        keywords: ['toggle', 'panel'],
        run: () => helpers.toggleArtifactsPanel(),
      },
    );
  }

  if (context.isDesktop) {
    const target: WindowKind = isWorkspace ? 'ide' : 'workspace';
    commands.push({
      id: `window.${target}`,
      group: 'Window',
      title: isWorkspace ? 'Open the IDE window' : 'Open the Agent window',
      keywords: ['switch', 'workspace', 'ide', 'focus'],
      shortcut: formatShortcut('E'),
      run: () => helpers.showWindow(target),
    });
  }

  for (const option of BACKEND_OPTIONS) {
    commands.push({
      id: `model.${option.id}`,
      group: 'AI model',
      title: `Use ${option.label}`,
      keywords: ['model', 'backend', 'provider', 'ai', 'switch'],
      isCurrent: option.id === context.selectedBackend,
      run: () => helpers.setSelectedBackend(option.id),
    });
  }

  if (context.isDesktop) {
    commands.push({
      id: 'project.openFolder',
      group: 'Project',
      title: 'Open folder…',
      keywords: ['project', 'directory', 'browse'],
      run: () => helpers.selectFolder(),
    });
  }

  return commands;
}

/**
 * The commands matching `query`, best first. Every word of the query must
 * appear in the title, group or keywords (case-insensitive). Commands whose
 * title starts with the query come first; otherwise the list order is kept.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [...commands];
  }
  const needle = words.join(' ');
  const matches = commands.filter((command) => {
    const haystack = [command.title, command.group, ...(command.keywords ?? [])].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  // `sort` is stable, so equal ranks keep their list order.
  const rank = (command: Command): number => (command.title.toLowerCase().startsWith(needle) ? 0 : 1);
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
