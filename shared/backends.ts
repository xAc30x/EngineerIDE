import type { BackendProvider } from './types';

export interface BackendOption {
  id: BackendProvider;
  label: string;
}

/** Backends offered in the selector, in display order. */
export const BACKEND_OPTIONS: readonly BackendOption[] = [
  { id: 'claude-cli', label: 'Claude Sub (CLI)' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'anthropic-api', label: 'Anthropic API' },
  { id: 'openai-api', label: 'OpenAI API' },
];

export const DEFAULT_BACKEND: BackendProvider = 'claude-cli';

export function isBackendProvider(value: string): value is BackendProvider {
  return BACKEND_OPTIONS.some((option) => option.id === value);
}

export function getBackendLabel(id: BackendProvider): string {
  return BACKEND_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
