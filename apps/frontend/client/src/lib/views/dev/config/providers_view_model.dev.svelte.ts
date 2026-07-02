// apps/frontend/client/src/lib/views/dev/config/providers_view_model.dev.svelte.ts
//
// Dev sandbox override — extends the production ProvidersViewModel to inject
// mock API responses and toggle dev-only UI flags. NEVER import this file
// from production code or non-(dev) routes.

import {
  ProvidersViewModel,
  type ProvidersViewModelOptions,
} from '$lib/views/settings/providers/providers_view_model.svelte';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DevProvidersViewModel extends ProvidersViewModel {
  // ── Dev-only flags ────────────────────────────────────────────────────

  /** When true, mock API responses are used instead of real network calls. */
  useMockResponses = $state(false);

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await super.initialize();
    this.debug('DevProvidersViewModel: initialized with dev overrides');
  }

  // ── Override: API key verification (mockable) ─────────────────────────

  override async verifyApiKey(provider: string): Promise<void> {
    if (this.useMockResponses) {
      // Simulate a successful verification after a brief delay
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'checking' };
      await new Promise((resolve) => setTimeout(resolve, 400));
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'valid' };
      return;
    }
    await super.verifyApiKey(provider);
  }

  // ── Override: service detection (mockable) ────────────────────────────

  override async detectServices(): Promise<void> {
    if (this.useMockResponses) {
      this.isDetecting = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
      this.isDetecting = false;
      return;
    }
    await super.detectServices();
  }

  // ── Dev-only methods ──────────────────────────────────────────────────

  /** Toggles mock response mode for all network-dependent operations. */
  toggleMockMode(): void {
    this.useMockResponses = !this.useMockResponses;
    this.debug('DevProvidersViewModel: mock mode', { enabled: this.useMockResponses });
  }
}

/**
 * Factory function — returns a DevProvidersViewModel with dev overrides.
 * Only use in (dev) routes or tests.
 */
export const getDevProvidersViewModel = (
  options: ProvidersViewModelOptions,
): DevProvidersViewModel => {
  return new DevProvidersViewModel(options);
};
