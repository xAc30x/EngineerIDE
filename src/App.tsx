import { useEffect } from 'react';
import { IdeView } from './components/ide/IdeView';
import { Header } from './components/shell/Header';
import { Sidebar } from './components/sidebar/Sidebar';
import { WorkspaceView } from './components/workspace/WorkspaceView';
import { otherWindowKind, showWindow, WINDOW_KIND } from './lib/windowKind';
import { useAppStore } from './store/useAppStore';

/**
 * Registers the window-wide shortcuts: Ctrl/Cmd+E opens or focuses the other
 * window, and Ctrl/Cmd+B toggles the sidebar of the Workspace window.
 */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey;
      if (!hasModifier || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'e') {
        event.preventDefault();
        showWindow(otherWindowKind(WINDOW_KIND));
      } else if (key === 'b' && WINDOW_KIND === 'workspace') {
        event.preventDefault();
        useAppStore.getState().toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/** Workspace window: sidebar, header, and the chat or a sidebar page. */
function WorkspaceWindow() {
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);

  return (
    <div className="flex h-full bg-canvas text-fg">
      {!isSidebarCollapsed && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1">
          <WorkspaceView />
        </main>
      </div>
    </div>
  );
}

/** IDE window: header, then explorer, editor, and agent chat. It has no sidebar. */
function IdeWindow() {
  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <Header />
      <main className="min-h-0 flex-1">
        <IdeView />
      </main>
    </div>
  );
}

/**
 * Both windows load this same app. Each renders one layout, chosen by the
 * window kind in the page URL, and shares state through the main process.
 */
export default function App() {
  useGlobalShortcuts();
  return WINDOW_KIND === 'ide' ? <IdeWindow /> : <WorkspaceWindow />;
}
