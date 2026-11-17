import { BrowserWindow, dialog } from 'electron';
import { FS_CHANNELS } from '../../shared/ipc/fs';
import type { FileContent, FileNode, FileSaveResult, SelectedFolder } from '../../shared/types';
import type { AppStateStore } from '../appStateStore';
import type { ProjectFileAccess } from '../projectFiles';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface FsIpcDependencies {
  windows: WindowRegistry;
  projectFiles: ProjectFileAccess;
  appState: AppStateStore;
}

export function registerFsIpc({ windows, projectFiles, appState }: FsIpcDependencies): void {
  handleFromAppWindow<SelectedFolder | null>(FS_CHANNELS.selectFolder, windows, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (parent === null) {
      return { ok: false, error: 'The window that asked for a folder is no longer open.' };
    }
    const result = await dialog.showOpenDialog(parent, {
      title: 'Select project folder',
      properties: ['openDirectory'],
    });
    const selectedPath = result.filePaths[0];
    if (result.canceled || selectedPath === undefined) {
      return { ok: true, value: null };
    }
    const approved = await projectFiles.approveRoot(selectedPath);
    if (approved.ok) {
      // The active project is set here, from the dialog result, so a window
      // can never make an unapproved path the project.
      appState.dispatch({ type: 'setActiveProject', folder: approved.value });
    }
    return approved;
  });

  handleFromAppWindow<FileNode[]>(FS_CHANNELS.readDir, windows, (_event, dirPath) =>
    projectFiles.readDir(dirPath),
  );

  handleFromAppWindow<FileContent>(FS_CHANNELS.readFile, windows, (_event, filePath) =>
    projectFiles.readFile(filePath),
  );

  handleFromAppWindow<FileSaveResult>(
    FS_CHANNELS.writeFile,
    windows,
    (_event, filePath, content, expectedMtimeMs) =>
      projectFiles.writeFile(filePath, content, expectedMtimeMs),
  );
}
