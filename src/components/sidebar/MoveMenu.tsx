import { FolderInput } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { IconButton } from '../shared/IconButton';
import { moveTargets } from './moveThread';

interface MoveMenuProps {
  threadId: string;
  threadTitle: string;
  /** The section the chat is in, or `null` for Recents. */
  sectionId: string | null;
}

/** "Move to…" button on a chat row: a short list of sections to move it to. */
export function MoveMenu({ threadId, threadTitle, sectionId }: MoveMenuProps) {
  const sections = useAppStore((state) => state.sections);
  const moveThread = useAppStore((state) => state.moveThread);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const targets = moveTargets(sections, sectionId);

  // Closes on Escape or a click anywhere else.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        label={`Move ${threadTitle} to…`}
        onClick={() => setIsOpen((open) => !open)}
        isActive={isOpen}
        className="size-6"
      >
        <FolderInput className="size-3.5" aria-hidden />
      </IconButton>
      {isOpen && (
        <div
          role="menu"
          aria-label={`Move ${threadTitle} to`}
          className="absolute right-0 z-20 mt-1 min-w-36 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {targets.map((target) => (
            <button
              key={target.id ?? 'recents'}
              type="button"
              role="menuitem"
              onClick={() => {
                moveThread(threadId, target.id);
                setIsOpen(false);
              }}
              className="block w-full truncate rounded px-2 py-1 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              {target.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
