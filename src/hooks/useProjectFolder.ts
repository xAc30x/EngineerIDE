import { useCallback, useState } from 'react';
import { getBridge } from '../lib/bridge';
import { useAppStore } from '../store/useAppStore';

const BRIDGE_UNAVAILABLE_ERROR = 'Folder selection is only available in the desktop app.';

export interface ProjectFolder {
  projectPath: string | null;
  projectName: string | null;
  /** Message from the most recent failed selection, or `null`. */
  error: string | null;
  /** Opens the native folder dialog. The choice becomes the project in every window. */
  selectFolder: () => Promise<void>;
}

/** Shared access to the active project folder and the native folder dialog. */
export function useProjectFolder(): ProjectFolder {
  const projectPath = useAppStore((state) => state.activeProjectPath);
  const projectName = useAppStore((state) => state.activeProjectName);
  const [error, setError] = useState<string | null>(null);

  const selectFolder = useCallback(async () => {
    const api = getBridge();
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
      // The main process sets the active project itself and broadcasts it,
      // so there is nothing to store here.
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return { projectPath, projectName, error, selectFolder };
}
