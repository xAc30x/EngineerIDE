import { describe, expect, it } from 'vitest';
import { otherWindowKind, parseWindowKind } from '../src/lib/windowKind';

describe('window kind', () => {
  it('reads the IDE window from the page URL', () => {
    expect(parseWindowKind('?window=ide')).toBe('ide');
    expect(parseWindowKind('?theme=dark&window=ide')).toBe('ide');
  });

  it('treats everything else as the Workspace window', () => {
    expect(parseWindowKind('')).toBe('workspace');
    expect(parseWindowKind('?window=workspace')).toBe('workspace');
    expect(parseWindowKind('?window=something-else')).toBe('workspace');
  });

  it('names the other window', () => {
    expect(otherWindowKind('workspace')).toBe('ide');
    expect(otherWindowKind('ide')).toBe('workspace');
  });
});
