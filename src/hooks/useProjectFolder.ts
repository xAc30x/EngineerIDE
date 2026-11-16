import { useCallback, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

const BRIDGE_UNAVAILABLE_ERROR = 'Folder selection is only available in the desktop app.';

export interface ProjectFolder {
  projectPath: string | null;
  projectName: string | null;
  /** Message from the most recent failed selection, or `null`. */
  error: string | null;
  /** Opens the native folder dialog and stores the selection. */
  selectFolder: () => Promise<void>;
}

/** Shared access to the active project folder and the native folder dialog. */
export function useProjectFolder(): ProjectFolder {
  const projectPath = useAppStore((state) => state.activeProjectPath);
  const projectName = useAppStore((state) => state.activeProjectName);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [error, setError] = useState<string | null>(null);

  const selectFolder = useCallback(async () => {
    const api = window.electronAPI;
    if (api === undefined) {
      setError(BRIDGE_UNAVAILABLE_ERROR);
      return;
    }
    try {
      const result = await api.selectFolder();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      // `null` means the dialog was cancelled; the current folder is kept.
      if (result.value !== null) {
        setActiveProject(result.value);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setActiveProject]);

  return { projectPath, projectName, error, selectFolder };
}
