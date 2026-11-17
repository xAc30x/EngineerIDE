import type { FileContent, FileNode, FileSaveResult, IpcResult, SelectedFolder } from '../types';

export const FS_CHANNELS = {
  selectFolder: 'fs:selectFolder',
  readDir: 'fs:readDir',
  readFile: 'fs:readFile',
  writeFile: 'fs:writeFile',
} as const;

export interface FsApi {
  /**
   * Opens the native folder dialog. The chosen folder becomes the active
   * project for every window. Resolves with `null` when the user cancels.
   */
  selectFolder(): Promise<IpcResult<SelectedFolder | null>>;
  /** Lists one folder level. The folder must be inside a previously selected folder. */
  readDir(dirPath: string): Promise<IpcResult<FileNode[]>>;
  /**
   * Reads a UTF-8 text file inside a selected folder, with its modification
   * time. Folders, binary files and files over the size limit are refused.
   */
  readFile(filePath: string): Promise<IpcResult<FileContent>>;
  /**
   * Saves an existing file inside a selected folder. `expectedMtimeMs` is the
   * time from the read (or the previous save); main refuses the save, writing
   * nothing, if the file changed on disk since then.
   */
  writeFile(
    filePath: string,
    content: string,
    expectedMtimeMs: number,
  ): Promise<IpcResult<FileSaveResult>>;
}
