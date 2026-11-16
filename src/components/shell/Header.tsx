import { PanelLeft, PanelRight } from 'lucide-react';
import { NAV_TAB_LABELS } from '../../config/navigation';
import { formatShortcut } from '../../lib/platform';
import { DEFAULT_THREAD_TITLE, selectActiveThread, useAppStore } from '../../store/useAppStore';
import type { AppMode } from '../../types';
import { IconButton } from '../shared/IconButton';

const MODE_OPTIONS: readonly { mode: AppMode; label: string }[] = [
  { mode: 'workspace', label: 'Workspace' },
  { mode: 'ide', label: 'IDE' },
];

function ModeToggle() {
  const activeMode = useAppStore((state) => state.activeMode);
  const setActiveMode = useAppStore((state) => state.setActiveMode);
  const shortcut = formatShortcut('E');

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="View mode"
        className="flex rounded-lg border border-line bg-sidebar p-0.5"
      >
        {MODE_OPTIONS.map(({ mode, label }) => {
          const isActive = mode === activeMode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              title={`${label} mode (${shortcut} switches modes)`}
              onClick={() => setActiveMode(mode)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                isActive ? 'bg-hover text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <kbd className="rounded border border-line px-1.5 py-0.5 font-sans text-[11px] text-subtle">
        {shortcut}
      </kbd>
    </div>
  );
}

/** Top bar of the shell: sidebar toggle, current title, and the mode switch. */
export function Header() {
  const activeMode = useAppStore((state) => state.activeMode);
  const activeNavTab = useAppStore((state) => state.activeNavTab);
  const thread = useAppStore(selectActiveThread);
  const projectName = useAppStore((state) => state.activeProjectName);
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);
  const isArtifactsPanelOpen = useAppStore((state) => state.isArtifactsPanelOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const toggleArtifactsPanel = useAppStore((state) => state.toggleArtifactsPanel);

  const isWorkspaceChat = activeMode === 'workspace' && activeNavTab === 'chat';

  let title: string;
  if (activeMode === 'ide') {
    title = projectName ?? 'No folder open';
  } else if (activeNavTab === 'chat') {
    title = thread?.title ?? DEFAULT_THREAD_TITLE;
  } else {
    title = NAV_TAB_LABELS[activeNavTab];
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <IconButton
        label={`${isSidebarCollapsed ? 'Show' : 'Hide'} sidebar (${formatShortcut('B')})`}
        onClick={toggleSidebar}
      >
        <PanelLeft className="size-4" aria-hidden />
      </IconButton>

      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{title}</h1>

      <ModeToggle />

      {isWorkspaceChat && (
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
