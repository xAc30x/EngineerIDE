import {
  CalendarClock,
  FolderKanban,
  FolderOpen,
  Layers,
  type LucideIcon,
  Palette,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NAV_TAB_LABELS } from '../../config/navigation';
import { useProjectFolder } from '../../hooks/useProjectFolder';
import { canShowWindows, showWindow } from '../../lib/windowKind';
import { useAppStore } from '../../store/useAppStore';
import type { NavTab } from '../../types';
import { ChatPanel } from '../shared/ChatPanel';
import { IconButton } from '../shared/IconButton';

type PreviewTab = 'artifacts' | 'design';

const PREVIEW_TABS: readonly { tab: PreviewTab; label: string; emptyText: string }[] = [
  {
    tab: 'artifacts',
    label: 'Artifacts',
    emptyText: 'Documents and code produced in a chat will open here.',
  },
  {
    tab: 'design',
    label: 'Design',
    emptyText: 'Live previews of generated interfaces will open here.',
  },
];

/** Right-hand split pane next to the chat. Its content arrives in a later milestone. */
function ArtifactsPanel() {
  const toggleArtifactsPanel = useAppStore((state) => state.toggleArtifactsPanel);
  const [activeTab, setActiveTab] = useState<PreviewTab>('artifacts');
  const emptyText = PREVIEW_TABS.find(({ tab }) => tab === activeTab)?.emptyText;

  return (
    <aside
      aria-label="Artifacts and design preview"
      className="flex w-[42%] max-w-2xl min-w-80 shrink-0 flex-col border-l border-line bg-sidebar"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        {PREVIEW_TABS.map(({ tab, label }) => (
          <button
            key={tab}
            type="button"
            aria-pressed={tab === activeTab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === activeTab ? 'bg-hover text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <IconButton label="Hide artifacts panel" onClick={toggleArtifactsPanel}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="max-w-xs text-center text-sm text-subtle">{emptyText}</p>
      </div>
    </aside>
  );
}

interface PageProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}

/** Full-width page shown for the non-chat sidebar destinations. */
function Page({ icon: Icon, title, description, children }: PageProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-muted" aria-hidden />
          <h2 className="text-xl font-semibold text-fg">{title}</h2>
        </div>
        <p className="mt-2 text-sm text-muted">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-subtle">
      {text}
    </div>
  );
}

function ProjectsPage() {
  const { projectPath, projectName, error, selectFolder } = useProjectFolder();

  return (
    <Page
      icon={FolderKanban}
      title={NAV_TAB_LABELS.projects}
      description="The project folder is shared by the chat and by the IDE window."
    >
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-xs font-medium text-subtle">Active folder</p>
        <p className="mt-1 truncate text-sm text-fg" title={projectPath ?? undefined}>
          {projectName ?? 'No folder selected'}
        </p>
        {projectPath !== null && (
          <p className="mt-0.5 truncate font-mono text-xs text-subtle">{projectPath}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void selectFolder()}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
          >
            <FolderOpen className="size-3.5" aria-hidden />
            {projectPath === null ? 'Open folder' : 'Change folder'}
          </button>
          {projectPath !== null && canShowWindows() && (
            <button
              type="button"
              onClick={() => showWindow('ide')}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              Open in IDE window
            </button>
          )}
        </div>
        {error !== null && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-subtle">
        A list of saved projects is planned for a later milestone.
      </p>
    </Page>
  );
}

const PLACEHOLDER_PAGES: Readonly<
  Record<Exclude<NavTab, 'chat' | 'projects'>, { icon: LucideIcon; description: string; emptyText: string }>
> = {
  artifacts: {
    icon: Layers,
    description: 'Documents, code, and other outputs created in chats.',
    emptyText: 'No artifacts yet. This library is planned for a later milestone.',
  },
  scheduled: {
    icon: CalendarClock,
    description: 'Tasks that run on a schedule.',
    emptyText: 'No scheduled tasks. Scheduling is planned for a later milestone.',
  },
  design: {
    icon: Palette,
    description: 'Visual previews of generated interfaces.',
    emptyText: 'No designs yet. The design preview is planned for a later milestone.',
  },
};

/** Workspace window content: centered chat with an optional artifacts pane, or a sidebar page. */
export function WorkspaceView() {
  const activeNavTab = useAppStore((state) => state.activeNavTab);
  const isArtifactsPanelOpen = useAppStore((state) => state.isArtifactsPanelOpen);

  if (activeNavTab === 'chat') {
    return (
      <div className="flex h-full">
        <div className="min-w-0 flex-1">
          <ChatPanel variant="centered" />
        </div>
        {isArtifactsPanelOpen && <ArtifactsPanel />}
      </div>
    );
  }

  if (activeNavTab === 'projects') {
    return <ProjectsPage />;
  }

  const page = PLACEHOLDER_PAGES[activeNavTab];
  return (
    <Page icon={page.icon} title={NAV_TAB_LABELS[activeNavTab]} description={page.description}>
      <EmptyCard text={page.emptyText} />
    </Page>
  );
}
