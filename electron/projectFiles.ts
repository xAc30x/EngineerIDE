import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  FileContent,
  FileNode,
  FileSaveResult,
  IpcResult,
  SelectedFolder,
} from '../shared/types';

/** Largest file `readFile` and `writeFile` handle, in bytes (Phase 4a). */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ENOENT: 'The folder no longer exists.',
  ENOTDIR: 'The path is not a folder.',
  EACCES: 'Permission denied.',
  EPERM: 'Permission denied.',
};

const FILE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ...ERROR_MESSAGES,
  ENOENT: 'The file no longer exists.',
  EISDIR: 'The path is a folder.',
};

const OUTSIDE_PROJECT_FOLDER = 'Access denied: the folder is outside the selected project folder.';
const OUTSIDE_PROJECT_FILE = 'Access denied: the file is outside the selected project folder.';
const NOT_A_FILE = 'The path is not a file.';
const TOO_LARGE = `The file is larger than ${MAX_TEXT_FILE_BYTES / (1024 * 1024)} MB.`;
const NOT_TEXT = 'The file is not UTF-8 text.';

function describeError(error: unknown, messages = ERROR_MESSAGES): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return (code !== undefined ? messages[code] : undefined) ?? error.message;
  }
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** True when `target` is `root` itself or is located inside it. */
function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') {
    return true;
  }
  const leavesRoot = relative === '..' || relative.startsWith(`..${path.sep}`);
  // On Windows a path on another drive has no relative form and stays absolute.
  return !leavesRoot && !path.isAbsolute(relative);
}

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Turns file bytes into text, or `null` when saving the text back could not
 * reproduce the bytes: a NUL byte (binary) or an invalid UTF-8 sequence.
 * A byte order mark is kept in the text, so it is written back on save.
 */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) {
    return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decides whether a save may go ahead. `expectedMtimeMs` is the time the
 * window got from the read (or from its previous save); `current` is the
 * file on disk right now, or `null` when it no longer exists.
 *
 * Returns `null` to allow the save, or the refusal to send back.
 */
export function checkSave(
  expectedMtimeMs: number,
  current: { mtimeMs: number } | null,
): FileSaveResult | null {
  if (current === null) {
    return { status: 'missing' };
  }
  // Any difference refuses, older included: a restored backup is still a
  // change the window never saw. Both times come from `stat`, so an
  // unchanged file gives exactly the same number.
  if (current.mtimeMs !== expectedMtimeMs) {
    return { status: 'changedOnDisk', mtimeMs: current.mtimeMs };
  }
  return null;
}

/**
 * Limits file system access to folders the user selected in the native
 * dialog. Paths arriving over IPC are untrusted: they are resolved (including
 * symbolic links) and must end up inside an approved folder.
 */
export class ProjectFileAccess {
  private readonly approvedRoots = new Set<string>();

  /** Registers a folder chosen by the user as readable. */
  async approveRoot(folderPath: string): Promise<IpcResult<SelectedFolder>> {
    try {
      const root = await fs.realpath(path.resolve(folderPath));
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) {
        return fail('The selected path is not a folder.');
      }
      this.approvedRoots.add(root);
      // A drive root such as `C:\` has an empty base name; show the path instead.
      return { ok: true, value: { path: root, name: path.basename(root) || root } };
    } catch (error) {
      return fail(`Could not open the folder. ${describeError(error)}`);
    }
  }

  private isApproved(resolved: string): boolean {
    return [...this.approvedRoots].some((root) => isInside(root, resolved));
  }

  /** Lists one level of a folder: folders first, then files, sorted by name. */
  async readDir(dirPath: unknown): Promise<IpcResult<FileNode[]>> {
    if (typeof dirPath !== 'string' || dirPath.length === 0) {
      return fail('Invalid folder path.');
    }

    let resolved: string;
    try {
      resolved = await fs.realpath(path.resolve(dirPath));
    } catch (error) {
      return fail(`Could not read the folder. ${describeError(error)}`);
    }

    if (!this.isApproved(resolved)) {
      return fail(OUTSIDE_PROJECT_FOLDER);
    }

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const nodes = entries.map<FileNode>((entry) => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
        isDirectory: entry.isDirectory(),
      }));
      return { ok: true, value: nodes.sort(compareNodes) };
    } catch (error) {
      return fail(`Could not read the folder. ${describeError(error)}`);
    }
  }

  /**
   * Reads a UTF-8 text file with its modification time. The time is taken
   * before the bytes, through the same open file, so a change made during
   * the read makes the next save refused rather than silently overwritten.
   */
  async readFile(filePath: unknown): Promise<IpcResult<FileContent>> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return fail('Invalid file path.');
    }

    let resolved: string;
    try {
      resolved = await fs.realpath(path.resolve(filePath));
    } catch (error) {
      return fail(`Could not read the file. ${describeError(error, FILE_ERROR_MESSAGES)}`);
    }
    if (!this.isApproved(resolved)) {
      return fail(OUTSIDE_PROJECT_FILE);
    }

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(resolved, 'r');
      const stats = await handle.stat();
      if (!stats.isFile()) {
        return fail(NOT_A_FILE);
      }
      if (stats.size > MAX_TEXT_FILE_BYTES) {
        return fail(TOO_LARGE);
      }
      const bytes = await handle.readFile();
      if (bytes.length > MAX_TEXT_FILE_BYTES) {
        return fail(TOO_LARGE);
      }
      const content = decodeText(bytes);
      if (content === null) {
        return fail(NOT_TEXT);
      }
      return { ok: true, value: { content, mtimeMs: stats.mtimeMs } };
    } catch (error) {
      return fail(`Could not read the file. ${describeError(error, FILE_ERROR_MESSAGES)}`);
    } finally {
      await handle?.close();
    }
  }

  /**
   * Saves an existing file if it has not changed on disk since
   * `expectedMtimeMs`. The check and the write use the same open file, and
   * the file is opened without create, so a save never makes a new file.
   */
  async writeFile(
    filePath: unknown,
    content: unknown,
    expectedMtimeMs: unknown,
  ): Promise<IpcResult<FileSaveResult>> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return fail('Invalid file path.');
    }
    if (typeof content !== 'string') {
      return fail('Invalid file content.');
    }
    if (typeof expectedMtimeMs !== 'number' || !Number.isFinite(expectedMtimeMs)) {
      return fail('Invalid modification time.');
    }
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_TEXT_FILE_BYTES) {
      return fail(TOO_LARGE);
    }

    let resolved: string;
    try {
      resolved = await fs.realpath(path.resolve(filePath));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        // Say "missing" only for a path in the project, so a save cannot be
        // used to learn whether a file exists outside it.
        return this.isApproved(path.resolve(filePath))
          ? this.refuseOrFail(expectedMtimeMs, null)
          : fail(OUTSIDE_PROJECT_FILE);
      }
      return fail(`Could not save the file. ${describeError(error, FILE_ERROR_MESSAGES)}`);
    }
    if (!this.isApproved(resolved)) {
      return fail(OUTSIDE_PROJECT_FILE);
    }

    let handle: fs.FileHandle | undefined;
    try {
      // 'r+' opens for writing without creating or truncating.
      handle = await fs.open(resolved, 'r+');
      const before = await handle.stat();
      if (!before.isFile()) {
        return fail(NOT_A_FILE);
      }
      const refusal = checkSave(expectedMtimeMs, { mtimeMs: before.mtimeMs });
      if (refusal !== null) {
        return { ok: true, value: refusal };
      }
      // Written in place, so the file keeps its permissions and links.
      await handle.truncate(0);
      // One write call may write fewer bytes than asked; keep going until all are on disk.
      let written = 0;
      while (written < bytes.length) {
        const { bytesWritten } = await handle.write(
          bytes,
          written,
          bytes.length - written,
          written,
        );
        if (bytesWritten === 0) {
          throw new Error('The file could not be written completely.');
        }
        written += bytesWritten;
      }
      const after = await handle.stat();
      return { ok: true, value: { status: 'saved', mtimeMs: after.mtimeMs } };
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return this.refuseOrFail(expectedMtimeMs, null);
      }
      return fail(`Could not save the file. ${describeError(error, FILE_ERROR_MESSAGES)}`);
    } finally {
      await handle?.close();
    }
  }

  /** The answer for a file that is gone: `checkSave` must refuse it. */
  private refuseOrFail(expectedMtimeMs: number, current: null): IpcResult<FileSaveResult> {
    const refusal = checkSave(expectedMtimeMs, current);
    return refusal !== null
      ? { ok: true, value: refusal }
      : fail(`Could not save the file. ${FILE_ERROR_MESSAGES.ENOENT}`);
  }
}
