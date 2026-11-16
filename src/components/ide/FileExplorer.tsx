import { ChevronDown, ChevronRight, File, Folder, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FileNode } from '../../types';
import { IconButton } from '../shared/IconButton';

const BRIDGE_UNAVAILABLE_ERROR = 'File access is only available in the desktop app.';
const INDENT_PER_LEVEL_PX = 12;
const BASE_INDENT_PX = 8;

type DirectoryState =
  | { status: 'loading' }
  | { status: 'loaded'; entries: FileNode[] }
  | { status: 'error'; message: string };

async function readDirectory(dirPath: string): Promise<DirectoryState> {
  const api = window.electronAPI;
  if (api === undefined) {
    return { status: 'error', message: BRIDGE_UNAVAILABLE_ERROR };
  }
  try {
    const result = await api.readDir(dirPath);
    return result.ok
      ? { status: 'loaded', entries: result.value }
      : { status: 'error', message: result.error };
  } catch (cause) {
    return { status: 'error', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

function indentStyle(depth: number): { paddingLeft: number } {
  return { paddingLeft: BASE_INDENT_PX + depth * INDENT_PER_LEVEL_PX };
}

interface TreeLevelProps {
  dirPath: string;
  depth: number;
  directories: Readonly<Record<string, DirectoryState>>;
  expandedPaths: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleDirectory: (node: FileNode) => void;
  onSelectFile: (node: FileNode) => void;
}

/** Renders the contents of one folder and, recursively, of its expanded subfolders. */
function TreeLevel(props: TreeLevelProps) {
  const { dirPath, depth, directories, expandedPaths, selectedPath, onToggleDirectory, onSelectFile } =
    props;
  const state = directories[dirPath];

  if (state === undefined || state.status === 'loading') {
    return (
      <p style={indentStyle(depth)} className="py-1 text-xs text-subtle">
        Loading…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p role="alert" style={indentStyle(depth)} className="py-1 pr-2 text-xs text-danger">
        {state.message}
      </p>
    );
  }
  if (state.entries.length === 0) {
    return (
      <p style={indentStyle(depth)} className="py-1 text-xs text-subtle">
        Empty folder
      </p>
    );
  }

  return (
    <ul>
      {state.entries.map((node) => {
        const isExpanded = node.isDirectory && expandedPaths.has(node.path);
        const isSelected = !node.isDirectory && node.path === selectedPath;
        const Chevron = isExpanded ? ChevronDown : ChevronRight;
        const Icon = node.isDirectory ? Folder : File;
        return (
          <li key={node.path}>
            <button
              type="button"
              style={indentStyle(depth)}
              aria-expanded={node.isDirectory ? isExpanded : undefined}
              onClick={() => (node.isDirectory ? onToggleDirectory(node) : onSelectFile(node))}
              className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[13px] transition-colors ${
                isSelected ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {node.isDirectory ? (
                <Chevron className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{node.name}</span>
            </button>
            {isExpanded && <TreeLevel {...props} dirPath={node.path} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

interface FileExplorerProps {
  rootPath: string;
  rootName: string;
  selectedPath: string | null;
  onSelectFile: (node: FileNode) => void;
}

/**
 * File tree for the project folder. Each folder is read from disk the first
 * time it is expanded, through `window.electronAPI.readDir`.
 */
export function FileExplorer({ rootPath, rootName, selectedPath, onSelectFile }: FileExplorerProps) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());

  const loadDirectory = useCallback(async (dirPath: string) => {
    setDirectories((current) => ({ ...current, [dirPath]: { status: 'loading' } }));
    const state = await readDirectory(dirPath);
    setDirectories((current) => ({ ...current, [dirPath]: state }));
  }, []);

  useEffect(() => {
    void loadDirectory(rootPath);
  }, [rootPath, loadDirectory]);

  const refresh = () => {
    setDirectories({});
    setExpandedPaths(new Set());
    void loadDirectory(rootPath);
  };

  const toggleDirectory = (node: FileNode) => {
    const isExpanding = !expandedPaths.has(node.path);
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (isExpanding) {
        next.add(node.path);
      } else {
        next.delete(node.path);
      }
      return next;
    });
    if (isExpanding && directories[node.path] === undefined) {
      void loadDirectory(node.path);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1 pl-3">
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted uppercase"
          title={rootPath}
        >
          {rootName}
        </span>
        <IconButton label="Reload file tree" onClick={refresh} className="size-6">
          <RefreshCw className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <TreeLevel
          dirPath={rootPath}
          depth={0}
          directories={directories}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggleDirectory={toggleDirectory}
          onSelectFile={onSelectFile}
        />
      </div>
    </div>
  );
}
