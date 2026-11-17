/**
 * Window sizes and positions kept between runs (Phase 3c). Pure, so it is
 * unit-tested; `electron/windows.ts` applies the result.
 *
 * On Linux under Wayland an app cannot read or set its own position: Electron
 * reports one that means nothing, and the compositor ignores one that is set.
 * Only the size comes back there. Elsewhere the position comes back too, if
 * the window would still be on a screen.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindowBounds {
  width: number;
  height: number;
  /** Absent where the position cannot be known (Wayland). */
  x?: number;
  y?: number;
  isMaximized: boolean;
}

export interface WindowLimits {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** What to pass to `new BrowserWindow`, plus whether to maximise it after. */
export interface WindowPlacement {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

// Larger than any real screen; anything bigger is a damaged value.
const MAX_SIZE = 20000;
// How much of a window must be on a screen for its position to be kept.
const MIN_VISIBLE = 64;

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_SIZE;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_SIZE;
}

/** Reads a saved value. Returns `null` for anything that is not valid. */
export function parseWindowBounds(text: string | undefined): SavedWindowBounds | null {
  if (text === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { width, height, x, y, isMaximized } = value as Record<string, unknown>;
  if (!isSize(width) || !isSize(height) || typeof isMaximized !== 'boolean') return null;
  const bounds: SavedWindowBounds = { width, height, isMaximized };
  if (isCoordinate(x) && isCoordinate(y)) {
    bounds.x = x;
    bounds.y = y;
  }
  return bounds;
}

/** The value to save for a window, from its normal (not maximised) bounds. */
export function serializeWindowBounds(
  normal: Rect,
  isMaximized: boolean,
  canKnowPosition: boolean,
): string {
  const saved: SavedWindowBounds = {
    width: Math.round(normal.width),
    height: Math.round(normal.height),
    isMaximized,
  };
  if (canKnowPosition) {
    saved.x = Math.round(normal.x);
    saved.y = Math.round(normal.y);
  }
  return JSON.stringify(saved);
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Where a window opens: the saved size (never below the minimum, never
 * larger than the biggest screen), and the saved position only when enough
 * of the window would be on one of `screens`.
 */
export function placeWindow(
  limits: WindowLimits,
  saved: SavedWindowBounds | null,
  screens: readonly Rect[],
): WindowPlacement {
  if (saved === null) {
    return { width: limits.width, height: limits.height, isMaximized: false };
  }
  const maxWidth = Math.max(limits.minWidth, ...screens.map((screen) => screen.width));
  const maxHeight = Math.max(limits.minHeight, ...screens.map((screen) => screen.height));
  const width = Math.min(Math.max(saved.width, limits.minWidth), maxWidth);
  const height = Math.min(Math.max(saved.height, limits.minHeight), maxHeight);
  const placement: WindowPlacement = { width, height, isMaximized: saved.isMaximized };

  if (saved.x !== undefined && saved.y !== undefined) {
    const rect = { x: saved.x, y: saved.y, width, height };
    const isVisible = screens.some((screen) => {
      const shared = overlap(rect, screen);
      return shared.width >= MIN_VISIBLE && shared.height >= MIN_VISIBLE;
    });
    if (isVisible) {
      placement.x = saved.x;
      placement.y = saved.y;
    }
  }
  return placement;
}
