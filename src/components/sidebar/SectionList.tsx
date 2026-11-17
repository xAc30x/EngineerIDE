import { ChevronDown, ChevronRight, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { PINNED_SECTION_ID, useAppStore } from '../../store/useAppStore';
import type { SectionSummary as Section, ThreadSummary as Thread } from '../../types';
import { IconButton } from '../shared/IconButton';

interface ThreadRowProps {
  thread: Thread;
  isPinned: boolean;
}

function ThreadRow({ thread, isPinned }: ThreadRowProps) {
  const isActive = useAppStore((state) => state.activeThreadId === thread.id);
  const selectThread = useAppStore((state) => state.selectThread);
  const togglePinned = useAppStore((state) => state.togglePinned);

  return (
    <li
      className={`group/thread flex items-center rounded-md pr-1 transition-colors ${
        isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      <button
        type="button"
        onClick={() => selectThread(thread.id)}
        aria-current={isActive ? 'true' : undefined}
        title={thread.title}
        className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[13px]"
      >
        {thread.title}
      </button>
      <IconButton
        label={isPinned ? 'Unpin chat' : 'Pin chat'}
        onClick={() => togglePinned(thread.id)}
        className="size-6 opacity-0 group-hover/thread:opacity-100 focus-visible:opacity-100"
      >
        {isPinned ? (
          <PinOff className="size-3.5" aria-hidden />
        ) : (
          <Pin className="size-3.5" aria-hidden />
        )}
      </IconButton>
    </li>
  );
}

function ThreadList({ threads, isPinned }: { threads: Thread[]; isPinned: boolean }) {
  return (
    <ul className="flex flex-col gap-px">
      {threads.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} isPinned={isPinned} />
      ))}
    </ul>
  );
}

interface SectionBlockProps {
  section: Section;
  /** Threads to show, already filtered by the search text. */
  visibleItems: Thread[];
  /** While searching, sections are shown expanded regardless of their state. */
  isSearching: boolean;
}

function SectionBlock({ section, visibleItems, isSearching }: SectionBlockProps) {
  const toggleSectionCollapsed = useAppStore((state) => state.toggleSectionCollapsed);
  const createThread = useAppStore((state) => state.createThread);
  const removeSection = useAppStore((state) => state.removeSection);

  const isExpanded = isSearching || !section.isCollapsed;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <section aria-label={section.title}>
      <div className="group/section flex items-center pr-1">
        <button
          type="button"
          onClick={() => toggleSectionCollapsed(section.id)}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-medium text-subtle transition-colors hover:text-fg"
        >
          <Chevron className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{section.title}</span>
          <span className="ml-1 text-[11px] font-normal">{section.items.length}</span>
        </button>
        <div className="flex opacity-0 group-focus-within/section:opacity-100 group-hover/section:opacity-100">
          <IconButton
            label={`New chat in ${section.title}`}
            onClick={() => createThread(section.id)}
            className="size-6"
          >
            <Plus className="size-3.5" aria-hidden />
          </IconButton>
          {section.kind === 'custom' && (
            <IconButton
              label={`Remove section ${section.title} (its chats move to Recents)`}
              onClick={() => removeSection(section.id)}
              className="size-6"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </IconButton>
          )}
        </div>
      </div>

      {isExpanded &&
        (visibleItems.length > 0 ? (
          <ThreadList threads={visibleItems} isPinned={section.id === PINNED_SECTION_ID} />
        ) : (
          <p className="px-2 py-1 text-xs text-subtle">No chats yet</p>
        ))}
    </section>
  );
}

interface SectionListProps {
  /** Text from the sidebar search box; an empty string shows everything. */
  searchQuery: string;
}

/** Pinned section, user-created sections, and the Recents list. */
export function SectionList({ searchQuery }: SectionListProps) {
  const sections = useAppStore((state) => state.sections);
  const recents = useAppStore((state) => state.recents);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery !== '';
  const filterThreads = (threads: Thread[]): Thread[] =>
    isSearching
      ? threads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery))
      : threads;

  const visibleSections = sections
    .map((section) => ({ section, visibleItems: filterThreads(section.items) }))
    // While searching, sections without a matching chat are left out.
    .filter(({ visibleItems }) => !isSearching || visibleItems.length > 0);
  const visibleRecents = filterThreads(recents);
  const hasNoMatches = isSearching && visibleSections.length === 0 && visibleRecents.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {visibleSections.map(({ section, visibleItems }) => (
        <SectionBlock
          key={section.id}
          section={section}
          visibleItems={visibleItems}
          isSearching={isSearching}
        />
      ))}

      {(!isSearching || visibleRecents.length > 0) && (
        <section aria-label="Recents">
          <h2 className="px-2 py-1 text-xs font-medium text-subtle">Recents</h2>
          {visibleRecents.length > 0 ? (
            <ThreadList threads={visibleRecents} isPinned={false} />
          ) : (
            <p className="px-2 py-1 text-xs text-subtle">No chats yet</p>
          )}
        </section>
      )}

      {hasNoMatches && <p className="px-2 py-1 text-xs text-subtle">No chats match the search.</p>}
    </div>
  );
}
