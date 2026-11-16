import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { getBackendLabel } from '../../../shared/backends';
import { API_KEY_PROVIDERS, type ApiKeyProvider, type ApiKeyStatus } from '../../../shared/ipc/secrets';
import { getBridge } from '../../lib/bridge';

/**
 * Save or remove the API key of each API-key backend. A typed key goes to the
 * main process once, on Save, and the field is cleared. Nothing ever sends a
 * key back: this form only learns whether one is set.
 */
export function ApiKeySettings() {
  const bridge = getBridge();
  const [statuses, setStatuses] = useState<ApiKeyStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await getBridge()?.listApiKeys();
    if (result === undefined) {
      return;
    }
    if (result.ok) {
      setStatuses(result.value);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (bridge === undefined) {
    return <p className="text-sm text-subtle">API keys can only be managed in the desktop app.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {API_KEY_PROVIDERS.map((provider) => (
        <ApiKeyRow
          key={provider}
          provider={provider}
          isSet={statuses?.find((status) => status.id === provider)?.isSet ?? null}
          onChanged={refresh}
        />
      ))}
      {loadError !== null && (
        <p role="alert" className="text-xs text-danger">
          {loadError}
        </p>
      )}
      <p className="text-xs text-subtle">
        Keys are encrypted with your system keychain and stay on this computer. They are only sent to the
        provider they belong to.
      </p>
    </div>
  );
}

interface ApiKeyRowProps {
  provider: ApiKeyProvider;
  /** `null` while loading. */
  isSet: boolean | null;
  onChanged: () => Promise<void>;
}

function ApiKeyRow({ provider, isSet, onChanged }: ApiKeyRowProps) {
  const label = getBackendLabel(provider);
  const [draft, setDraft] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; error?: string } | undefined>) => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result !== undefined && !result.ok) {
        setError(result.error ?? 'Something went wrong.');
      }
      await onChanged();
    } catch {
      setError('Something went wrong.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = draft;
    // Cleared at once, whatever the result, so the key does not stay on screen.
    setDraft('');
    void run(() => getBridge()?.setApiKey(provider, key) ?? Promise.resolve(undefined));
  };

  const handleRemove = () => {
    void run(() => getBridge()?.clearApiKey(provider) ?? Promise.resolve(undefined));
  };

  const inputId = `api-key-${provider}`;
  return (
    <form onSubmit={handleSave} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
        <span className={`text-xs ${isSet ? 'text-fg' : 'text-subtle'}`}>
          {isSet === null ? 'Checking…' : isSet ? 'Key set' : 'Not set'}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          id={inputId}
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isSet ? 'Paste a new key to replace it' : 'Paste your API key'}
          autoComplete="off"
          spellCheck={false}
          disabled={isBusy}
          className="min-w-0 flex-1 rounded-lg border border-line bg-sidebar px-3 py-1.5 font-mono text-xs text-fg outline-none placeholder:font-sans placeholder:text-subtle focus:border-subtle"
        />
        <button
          type="submit"
          disabled={isBusy || draft.trim() === ''}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
        {isSet === true && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isBusy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            Remove
          </button>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
