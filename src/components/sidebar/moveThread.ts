import type { SectionSummary } from '../../types';

/**
 * Moving a chat between sections in the sidebar: by drag and drop, or with
 * the "Move to…" menu. Pure helpers, unit-tested; the shared `moveThread`
 * action does the move, and storage saves it.
 */

/** The drag data type that carries a chat id. Other drags are ignored. */
export const THREAD_DRAG_TYPE = 'application/x-engineeride-thread';

/** A place a chat can move to: a section, or Recents (`id: null`). */
export interface MoveTarget {
  id: string | null;
  label: string;
}

/** Every place a chat in `currentSectionId` (`null` for Recents) can move to. */
export function moveTargets(
  sections: readonly Pick<SectionSummary, 'id' | 'title'>[],
  currentSectionId: string | null,
): MoveTarget[] {
  const targets: MoveTarget[] = sections
    .filter((section) => section.id !== currentSectionId)
    .map((section) => ({ id: section.id, label: section.title }));
  if (currentSectionId !== null) {
    targets.push({ id: null, label: 'Recents' });
  }
  return targets;
}

/** True when a drag carries a chat, so a section may accept it. */
export function carriesThread(types: readonly string[]): boolean {
  return types.includes(THREAD_DRAG_TYPE);
}

/** The chat id a drop carries, or `null` when it carries none. */
export function droppedThreadId(read: (type: string) => string): string | null {
  const id = read(THREAD_DRAG_TYPE).trim();
  return id === '' ? null : id;
}
