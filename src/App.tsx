import { useEffect } from 'react';
import { IdeView } from './components/ide/IdeView';
import { Header } from './components/shell/Header';
import { Sidebar } from './components/sidebar/Sidebar';
import { WorkspaceView } from './components/workspace/WorkspaceView';
import { useAppStore } from './store/useAppStore';

/** Registers the window-wide shortcuts: Ctrl/Cmd+E (switch mode) and Ctrl/Cmd+B (sidebar). */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey;
      if (!hasModifier || event.altKey || event.shiftKey) {
        return;
      }
      const { toggleMode, toggleSidebar } = useAppStore.getState();
      switch (event.key.toLowerCase()) {
        case 'e':
          event.preventDefault();
          toggleMode();
          break;
        case 'b':
          event.preventDefault();
          toggleSidebar();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/**
 * Persistent outer shell: left sidebar, top header, and the mode viewport.
 * Both views stay mounted and only their visibility changes, so switching
 * modes is immediate and keeps each view's state (for example the expanded
 * folders in the file explorer).
 */
export default function App() {
  const activeMode = useAppStore((state) => state.activeMode);
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);

  useGlobalShortcuts();

  return (
    <div className="flex h-full bg-canvas text-fg">
      {!isSidebarCollapsed && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1">
          <div className={activeMode === 'workspace' ? 'h-full' : 'hidden'}>
            <WorkspaceView />
          </div>
          <div className={activeMode === 'ide' ? 'h-full' : 'hidden'}>
            <IdeView />
          </div>
        </main>
      </div>
    </div>
  );
}
