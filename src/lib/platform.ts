const MAC_PLATFORM = 'darwin';

/** Label of the main shortcut modifier key: `⌘` on macOS, `Ctrl` elsewhere. */
export function getModifierKeyLabel(): string {
  return window.electronAPI?.platform === MAC_PLATFORM ? '⌘' : 'Ctrl';
}

/** Formats a shortcut for display, for example `Ctrl+E` or `⌘E`. */
export function formatShortcut(key: string): string {
  const modifier = getModifierKeyLabel();
  return modifier === '⌘' ? `${modifier}${key}` : `${modifier}+${key}`;
}
