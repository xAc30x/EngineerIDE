import type { WindowKind } from '../types';
import { getBridge } from './bridge';

export const WINDOW_LABELS: Readonly<Record<WindowKind, string>> = {
  workspace: 'Workspace',
  ide: 'IDE',
};

/** Reads the window kind from the page URL: `?window=ide` is the IDE window. */
export function parseWindowKind(search: string): WindowKind {
  return new URLSearchParams(search).get('window') === 'ide' ? 'ide' : 'workspace';
}

/** Which of the two windows this page is. It never changes while the page lives. */
export const WINDOW_KIND: WindowKind = parseWindowKind(
  typeof window === 'undefined' ? '' : window.location.search,
);

export function otherWindowKind(kind: WindowKind): WindowKind {
  return kind === 'workspace' ? 'ide' : 'workspace';
}

/** True when this page can open the other window, which needs the desktop app. */
export function canShowWindows(): boolean {
  return getBridge() !== undefined;
}

/**
 * Opens the given window, or brings it to the front when it is already open.
 * This window stays open. Does nothing outside the desktop app.
 */
export function showWindow(kind: WindowKind): void {
  getBridge()
    ?.showWindow(kind)
    .then((result) => {
      if (!result.ok) {
        console.error(`Could not open the ${WINDOW_LABELS[kind]} window: ${result.error}`);
      }
    })
    .catch((error: unknown) => {
      console.error(`Could not open the ${WINDOW_LABELS[kind]} window:`, error);
    });
}
