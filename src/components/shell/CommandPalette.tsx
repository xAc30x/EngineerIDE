import { Check, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildCommands, cycleIndex, filterCommands, type Command } from '../../config/commands';
import { getBridge } from '../../lib/bridge';
import { canShowWindows, showWindow, WINDOW_KIND } from '../../lib/windowKind';
import { useAppStore } from '../../store/useAppStore';

const LIST_ID = 'command-palette-list';

/**
 * Opens the native folder dialog. The palette has closed by the time the
 * dialog answers, so a failure is logged; the main process sets the chosen
 * folder as the project and broadcasts it to every window.
 */
async function selectFolder(): Promise<void> {
  const result = await getBridge()?.selectFolder();
  if (result !== undefined && !result.ok) {
    console.error(`Could not open the folder: ${result.error}`);
  }
}

function optionId(command: Command): string {
  return `command-palette-${command.id.replace(/\W/g, '-')}`;
}

/**
 * The palette itself. It is mounted only while open, so every opening starts
 * with an empty search and the first row highlighted.
 */
function CommandPaletteDialog() {
  const close = useAppStore((state) => state.setCommandPaletteOpen);
  const setActiveNavTab = useAppStore((state) => state.setActiveNavTab);
  const createThread = useAppStore((state) => state.createThread);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const toggleArtifactsPanel = useAppStore((state) => state.toggleArtifactsPanel);
  const setSelectedBackend = useAppStore((state) => state.setSelectedBackend);
  const selectedBackend = useAppStore((state) => state.selectedBackend);
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);
  const isArtifactsPanelOpen = useAppStore((state) => state.isArtifactsPanelOpen);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () =>
      buildCommands(
        {
          showWindow,
          selectFolder,
          setActiveNavTab,
          createThread: () => createThread(),
          toggleSidebar,
          toggleArtifactsPanel,
          setSelectedBackend,
        },
        {
          windowKind: WINDOW_KIND,
          isDesktop: canShowWindows(),
          selectedBackend,
          isSidebarCollapsed,
          isArtifactsPanelOpen,
        },
      ),
    [
      setActiveNavTab,
      createThread,
      toggleSidebar,
      toggleArtifactsPanel,
      setSelectedBackend,
      selectedBackend,
      isSidebarCollapsed,
      isArtifactsPanelOpen,
    ],
  );
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const highlighted = results[Math.min(activeIndex, results.length - 1)];

  // Focus the search on open; give focus back to where it was on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (highlighted !== undefined) {
      document.getElementById(optionId(highlighted))?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  const run = (command: Command | undefined): void => {
    if (command === undefined) {
      return;
    }
    close(false);
    Promise.resolve(command.run()).catch((error: unknown) => {
      console.error(`The "${command.title}" command failed:`, error);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) =>
          cycleIndex(Math.min(index, results.length - 1), event.key === 'ArrowDown' ? 1 : -1, results.length),
        );
        break;
      case 'Enter':
        event.preventDefault();
        run(highlighted);
        break;
      case 'Escape':
        event.preventDefault();
        close(false);
        break;
      case 'Tab':
        // Focus stays in the palette while it is open.
        event.preventDefault();
        break;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // Keep focus in the search box when the panel is clicked, so the
        // arrow keys, Enter and Escape keep working.
        onMouseDown={(event) => {
          if (event.target !== inputRef.current) {
            event.preventDefault();
          }
        }}
        className="flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-activedescendant={highlighted === undefined ? undefined : optionId(highlighted)}
            aria-label="Search commands"
            placeholder="Type a command"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No matching commands</p>
        ) : (
          <ul id={LIST_ID} role="listbox" className="min-h-0 overflow-y-auto py-1">
            {results.map((command) => {
              const isActive = command === highlighted;
              return (
                <li
                  key={command.id}
                  id={optionId(command)}
                  role="option"
                  aria-selected={isActive}
                  onMouseMove={() => setActiveIndex(results.indexOf(command))}
                  onClick={() => run(command)}
                  className={`mx-1 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    isActive ? 'bg-hover text-fg' : 'text-muted'
                  }`}
                >
                  <span className="w-16 shrink-0 text-xs text-subtle">{command.group}</span>
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {command.isCurrent === true && (
                    <Check className="size-4 shrink-0 text-accent" aria-label="Current" />
                  )}
                  {command.shortcut !== undefined && (
                    <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 font-sans text-xs text-subtle">
                      {command.shortcut}
                    </kbd>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** This window's command palette, shown while `isCommandPaletteOpen` is set. */
export function CommandPalette() {
  const isOpen = useAppStore((state) => state.isCommandPaletteOpen);
  return isOpen ? <CommandPaletteDialog /> : null;
}
