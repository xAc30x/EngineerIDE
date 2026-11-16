import { Bot, FileCode, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useProjectFolder } from '../../hooks/useProjectFolder';
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

/** Center pane. The real code editor replaces this in a later milestone. */
function EditorPlaceholder({ file }: { file: FileNode | null }) {
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileCode className="size-8 text-line" aria-hidden />
        {file === null ? (
          <p className="text-sm text-subtle">Select a file in the explorer.</p>
        ) : (
          <>
            <p className="max-w-full truncate font-mono text-xs text-muted">{file.path}</p>
            <p className="text-sm text-subtle">
              The code editor is planned for a later milestone, so file contents are not shown yet.
            </p>
          </>
        )}
      </div>
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

/** IDE Mode: file explorer (left), editor area (center), docked agent chat (right). */
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
