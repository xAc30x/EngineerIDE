import { BACKEND_OPTIONS, getBackendLabel } from '../../shared/backends';
import type { BackendProvider, ProviderAvailability } from '../../shared/types';
import type { AIProviderAdapter } from './adapter';
import { createFakeProvider } from './fakeProvider';

export interface ProviderRegistryOptions {
  /**
   * Development builds only: a backend with no adapter yet answers with the
   * fake provider, and its replies start with `TEST_REPLY_PREFIX`.
   */
  allowTestStandIn: boolean;
}

export const TEST_REPLY_PREFIX = '[Test reply] ';
export const TEST_STAND_IN_REASON = 'Test replies until this backend is built.';

export type ProviderLookup =
  | { ok: true; adapter: AIProviderAdapter }
  | { ok: false; error: string };

/** The adapters the main process can reply with, one per backend. */
export class ProviderRegistry {
  private readonly adapters = new Map<BackendProvider, AIProviderAdapter>();
  private readonly standIns = new Map<BackendProvider, AIProviderAdapter>();

  constructor(private readonly options: ProviderRegistryOptions) {}

  /** Adds or replaces the adapter for `adapter.id`. */
  register(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** The adapter that replies for `id`, or why there is none. */
  get(id: BackendProvider): ProviderLookup {
    const adapter = this.adapters.get(id) ?? this.standIn(id);
    return adapter === undefined
      ? { ok: false, error: `${getBackendLabel(id)} is not available yet.` }
      : { ok: true, adapter };
  }

  /** Every backend in display order, with whether it can reply now. */
  async listAvailability(): Promise<ProviderAvailability[]> {
    return Promise.all(
      BACKEND_OPTIONS.map(async ({ id, label }): Promise<ProviderAvailability> => {
        const adapter = this.adapters.get(id);
        if (adapter !== undefined) {
          try {
            return { id, label, ...(await adapter.checkAvailability()) };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { id, label, available: false, reason };
          }
        }
        return this.options.allowTestStandIn
          ? { id, label, available: true, reason: TEST_STAND_IN_REASON }
          : { id, label, available: false, reason: `${label} is not available yet.` };
      }),
    );
  }

  private standIn(id: BackendProvider): AIProviderAdapter | undefined {
    if (!this.options.allowTestStandIn) {
      return undefined;
    }
    let adapter = this.standIns.get(id);
    if (adapter === undefined) {
      adapter = createFakeProvider({ id, label: getBackendLabel(id), prefix: TEST_REPLY_PREFIX });
      this.standIns.set(id, adapter);
    }
    return adapter;
  }
}
