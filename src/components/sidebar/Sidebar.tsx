import {
  CalendarClock,
  FolderKanban,
  FolderOpen,
  Layers,
  type LucideIcon,
  Palette,
  Plus,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { NAV_TAB_LABELS } from '../../config/navigation';
import { useProjectFolder } from '../../hooks/useProjectFolder';
import { useAppStore } from '../../store/useAppStore';
import type { NavTab } from '../../types';
import { IconButton } from '../shared/IconButton';
import { SectionList } from './SectionList';

const PAGE_TABS: readonly { tab: Exclude<NavTab, 'chat'>; icon: LucideIcon }[] = [
  { tab: 'projects', icon: FolderKanban },
  { tab: 'artifacts', icon: Layers },
  { tab: 'scheduled', icon: CalendarClock },
  { tab: 'design', icon: Palette },
];

interface NavButtonProps {
  icon: LucideIcon;
  label: string;
  isActive?: boolean;
  onClick: () => void;
}

function NavButton({ icon: Icon, label, isActive = false, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
        isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** `+ New Section` button that turns into a name input while adding. */
function NewSectionControl() {
  const addSection = useAppStore((state) => state.addSection);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');

  const close = () => {
    setIsAdding(false);
    setTitle('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // A blank name adds nothing; the input simply closes.
    addSection(title);
    close();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      close();
    }
  };

  if (!isAdding) {
    return (
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2 py-1.5 text-left text-xs text-muted transition-colors hover:border-subtle hover:text-fg"
      >
        <Plus className="size-3.5 shrink-0" aria-hidden />
        New Section
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={close}
        maxLength={60}
        placeholder="Section name, then Enter"
        aria-label="New section name"
        className="w-full rounded-md border border-subtle bg-surface px-2 py-1.5 text-xs text-fg outline-none placeholder:text-subtle"
      />
    </form>
  );
}

/** Bottom bar: active project folder and the settings entry point. */
function ProjectBar() {
  const { projectPath, projectName, error, selectFolder } = useProjectFolder();

  return (
    <div className="shrink-0 border-t border-line p-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void selectFolder()}
          title={projectPath ?? 'Open a project folder'}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <FolderOpen className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{projectName ?? 'Open folder…'}</span>
        </button>
        <IconButton label="Settings (available in a later milestone)" disabled>
          <Settings className="size-4" aria-hidden />
        </IconButton>
      </div>
      {error !== null && (
        <p role="alert" className="px-2 pt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Left column of the Workspace window. */
export function Sidebar() {
  const activeNavTab = useAppStore((state) => state.activeNavTab);
  const setActiveNavTab = useAppStore((state) => state.setActiveNavTab);
  const createThread = useAppStore((state) => state.createThread);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleSearch = () => {
    setIsSearchOpen((isOpen) => !isOpen);
    setSearchQuery('');
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex h-12 shrink-0 items-center px-4 text-sm font-semibold tracking-tight text-fg">
        EngineerIDE
      </div>

      <nav aria-label="Main" className="flex shrink-0 flex-col gap-px px-2">
        <NavButton icon={SquarePen} label="New chat" onClick={() => createThread()} />
        <NavButton icon={Search} label="Search" isActive={isSearchOpen} onClick={toggleSearch} />
        {isSearchOpen && (
          <input
            autoFocus
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search chats by title"
            aria-label="Search chats by title"
            className="my-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg outline-none placeholder:text-subtle focus:border-subtle"
          />
        )}
        {PAGE_TABS.map(({ tab, icon }) => (
          <NavButton
            key={tab}
            icon={icon}
            label={NAV_TAB_LABELS[tab]}
            isActive={activeNavTab === tab}
            onClick={() => setActiveNavTab(tab)}
          />
        ))}
      </nav>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
        <NewSectionControl />
        <SectionList searchQuery={searchQuery} />
      </div>

      <ProjectBar />
    </aside>
  );
}
