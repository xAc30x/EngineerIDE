import { Bot, FileCode, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useProjectFolder } from '../../hooks/useProjectFolder';
import { getBridge } from '../../lib/bridge';
import type { FileNode } from '../../types';
import { ChatPanel } from '../shared/ChatPanel';
import { FileExplorer } from './FileExplorer';

function ExplorerEmptyState() {
  const { error, selectFolder } = useProjectFolder();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-xs text-subtle">No folder is open.</p>
      <button
        type="button"
        onClick={() => void selectFolder()}
        className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
      >
        <FolderOpen className="size-3.5" aria-hidden />
        Open folder
      </button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'loaded'; content: string }
  | { status: 'error'; message: string };

/** Reads the selected file through `fs:readFile` (Phase 4a). */
function useFilePreview(filePath: string | null): PreviewState | null {
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (filePath === null) {
      setState(null);
      return;
    }
    const api = getBridge();
    if (api === undefined) {
      setState({
        status: 'error',
        message: 'File access is only available in the desktop app.',
      });
      return;
    }
    let current = true;
    setState({ status: 'loading' });
    api.readFile(filePath).then(
      (result) => {
        if (current) {
          setState(
            result.ok
              ? { status: 'loaded', content: result.value.content }
              : { status: 'error', message: result.error },
          );
        }
      },
      (cause: unknown) => {
        if (current) {
          setState({
            status: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [filePath]);

  return state;
}

/** Center pane: a read-only view of the selected file. Phase 4b replaces it with the editor. */
function EditorPlaceholder({ file }: { file: FileNode | null }) {
  const preview = useFilePreview(file?.path ?? null);

  return (
    <section aria-label="Editor" className="flex min-w-0 flex-1 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center border-b border-line">
        {file !== null && (
          <div
            className="flex h-full max-w-full items-center gap-2 border-r border-line bg-surface px-3 text-xs text-fg"
            title={file.path}
          >
            <FileCode className="size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{file.name}</span>
          </div>
        )}
      </div>
      {preview?.status === 'loaded' ? (
        <pre
          aria-label={`Contents of ${file?.name ?? 'file'}`}
          className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-5 text-fg"
        >
          {preview.content}
        </pre>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <FileCode className="size-8 text-line" aria-hidden />
          {file === null && <p className="text-sm text-subtle">Select a file in the explorer.</p>}
          {preview?.status === 'loading' && <p className="text-sm text-subtle">Loading…</p>}
          {preview?.status === 'error' && (
            <p role="alert" className="max-w-full text-sm text-danger">
              {preview.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

interface ProjectPanesProps {
  projectPath: string;
  projectName: string;
}

/** Explorer and editor for one project. Remounted when the project folder changes. */
function ProjectPanes({ projectPath, projectName }: ProjectPanesProps) {
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);

  return (
    <>
      <aside aria-label="File explorer" className="w-56 shrink-0 border-r border-line bg-sidebar">
        <FileExplorer
          rootPath={projectPath}
          rootName={projectName}
          selectedPath={selectedFile?.path ?? null}
          onSelectFile={setSelectedFile}
        />
      </aside>
      <EditorPlaceholder file={selectedFile} />
    </>
  );
}

/** IDE window content: file explorer (left), editor area (center), docked agent chat (right). */
export function IdeView() {
  const { projectPath, projectName } = useProjectFolder();

  return (
    <div className="flex h-full">
      {projectPath === null ? (
        <>
          <aside aria-label="File explorer" className="w-56 shrink-0 border-r border-line bg-sidebar">
            <ExplorerEmptyState />
          </aside>
          <EditorPlaceholder file={null} />
        </>
      ) : (
        // The key resets the tree and the selected file when another folder is opened.
        <ProjectPanes
          key={projectPath}
          projectPath={projectPath}
          projectName={projectName ?? projectPath}
        />
      )}

      <aside
        aria-label="Agent chat"
        className="flex w-[360px] shrink-0 flex-col border-l border-line bg-sidebar"
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs font-semibold tracking-wide text-muted uppercase">
          <Bot className="size-3.5" aria-hidden />
          Agent
        </div>
        <div className="min-h-0 flex-1">
          <ChatPanel variant="docked" />
        </div>
      </aside>
    </div>
  );
}
