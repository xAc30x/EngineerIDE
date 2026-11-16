import type { FileNode, IpcResult, SelectedFolder } from '../types';

export const FS_CHANNELS = {
  selectFolder: 'fs:selectFolder',
  readDir: 'fs:readDir',
} as const;

export interface FsApi {
  /**
   * Opens the native folder dialog. The chosen folder becomes the active
   * project for every window. Resolves with `null` when the user cancels.
   */
  selectFolder(): Promise<IpcResult<SelectedFolder | null>>;
  /** Lists one folder level. The folder must be inside a previously selected folder. */
  readDir(dirPath: string): Promise<IpcResult<FileNode[]>>;
}
