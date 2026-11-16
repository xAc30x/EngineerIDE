import { PanelLeft, PanelRight } from 'lucide-react';
import { NAV_TAB_LABELS } from '../../config/navigation';
import { formatShortcut } from '../../lib/platform';
import {
  canShowWindows,
  otherWindowKind,
  showWindow,
  WINDOW_KIND,
  WINDOW_LABELS,
} from '../../lib/windowKind';
import { DEFAULT_THREAD_TITLE, selectActiveThread, useAppStore } from '../../store/useAppStore';
import type { WindowKind } from '../../types';
import { IconButton } from '../shared/IconButton';

/** Text of the header button, by the window it is shown in. It names where the button leads. */
const SWITCH_BUTTON_LABELS: Readonly<Record<WindowKind, string>> = {
  workspace: 'IDE',
  ide: 'Agent Window',
};

/**
 * One button that opens the other window, or brings it to the front when it
 * is already open. This window stays open.
 */
function WindowSwitchButton() {
  const target = otherWindowKind(WINDOW_KIND);
  const isAvailable = canShowWindows();
  const title = isAvailable
    ? `Open the ${WINDOW_LABELS[target]} window (${formatShortcut('E')})`
    : `The ${WINDOW_LABELS[target]} window is only available in the desktop app`;

  return (
    <button
      type="button"
      disabled={!isAvailable}
      title={title}
      onClick={() => showWindow(target)}
      className="shrink-0 rounded-lg border border-line bg-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      {SWITCH_BUTTON_LABELS[WINDOW_KIND]}
    </button>
  );
}

/** Top bar of the Workspace window: sidebar toggle, title, IDE button, artifacts toggle. */
function WorkspaceHeader() {
  const activeNavTab = useAppStore((state) => state.activeNavTab);
  const thread = useAppStore(selectActiveThread);
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);
  const isArtifactsPanelOpen = useAppStore((state) => state.isArtifactsPanelOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const toggleArtifactsPanel = useAppStore((state) => state.toggleArtifactsPanel);

  const isChat = activeNavTab === 'chat';
  const title = isChat ? (thread?.title ?? DEFAULT_THREAD_TITLE) : NAV_TAB_LABELS[activeNavTab];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <IconButton
        label={`${isSidebarCollapsed ? 'Show' : 'Hide'} sidebar (${formatShortcut('B')})`}
        onClick={toggleSidebar}
      >
        <PanelLeft className="size-4" aria-hidden />
      </IconButton>

      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{title}</h1>

      <WindowSwitchButton />

      {isChat && (
        <IconButton
          label={`${isArtifactsPanelOpen ? 'Hide' : 'Show'} artifacts panel`}
          isActive={isArtifactsPanelOpen}
          onClick={toggleArtifactsPanel}
        >
          <PanelRight className="size-4" aria-hidden />
        </IconButton>
      )}
    </header>
  );
}

/** Top bar of the IDE window: the open folder's name and the Agent Window button. */
function IdeHeader() {
  const projectName = useAppStore((state) => state.activeProjectName);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
        {projectName ?? 'No folder open'}
      </h1>
      <WindowSwitchButton />
    </header>
  );
}

/** Top bar of the current window. */
export function Header() {
  return WINDOW_KIND === 'ide' ? <IdeHeader /> : <WorkspaceHeader />;
}
