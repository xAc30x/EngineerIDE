import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileNode, IpcResult, SelectedFolder } from '../shared/types';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ENOENT: 'The folder no longer exists.',
  ENOTDIR: 'The path is not a folder.',
  EACCES: 'Permission denied.',
  EPERM: 'Permission denied.',
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return (code !== undefined ? ERROR_MESSAGES[code] : undefined) ?? error.message;
  }
  return String(error);
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
 * Limits file system reads to folders the user selected in the native
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

    const isApproved = [...this.approvedRoots].some((root) => isInside(root, resolved));
    if (!isApproved) {
      return fail('Access denied: the folder is outside the selected project folder.');
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
}
