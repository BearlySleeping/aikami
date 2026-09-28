// apps/frontend/client/src/lib/services/audio/tts_backend_plan.ts

/**
 * Which speech backend the runtime should use, decided from configuration
 * alone — no I/O, no side effects.
 *
 * Extracted from `tts_service.svelte.ts` so the service owns *lifecycle*
 * (spawning, cancelling, reporting) while this owns *policy* (which endpoint
 * is legal, which provider this runtime can actually speak, whether a
 * credential may cross the wire). Every branch is a pure function of its
 * inputs, which is what makes each one testable in isolation — the service
 * method this came from was an unreachably complex ladder of early returns
 * interleaved with awaits.
 */

/** What the caller of {@link resolveTtsPlan} should do. */
export type TtsPlan =
  /** A reachable-in-principle server endpoint to probe. */
  | { readonly kind: 'server'; readonly url: string; readonly apiKey: string | undefined }
  /** No server; fall through to the in-browser Kokoro worker. */
  | { readonly kind: 'browser' }
  /** TTS is switched off. Nothing is probed. */
  | { readonly kind: 'disabled' }
  /**
   * A definitive failure the user must see. `retryable: false` marks the
   * cases no amount of retrying will fix (an unsupported provider, a
   * credential that cannot be sent safely).
   */
  | {
      readonly kind: 'terminal';
      readonly message: string;
      readonly retryable: boolean;
    };

export type ResolveTtsPlanOptions = {
  /** Effective mode: 'server' | 'browser' | 'disabled'. */
  readonly mode: 'server' | 'browser' | 'disabled';
  /** Configured server URL, if any. */
  readonly serverUrl: string | undefined;
  /** Registry id of the resolved narrator-voice provider, if any. */
  readonly providerId: string | undefined;
  /** Bearer credential for that provider, if any. */
  readonly apiKey: string | undefined;
  /** True inside a Tauri webview, where the CSP constrains connect-src. */
  readonly isDesktop: boolean;
};

/**
 * Registry IDs whose server speaks the exact Kokoro-shaped
 * `/v1/audio/speech` + `/v1/voices` surface this runtime implements
 * end-to-end (request shape AND health-check). Cloud providers advertised in
 * the registry (ElevenLabs, OpenAI TTS) use different real APIs that this
 * runtime does not implement — sending them the Kokoro request shape would
 * silently fail or, worse, appear to "work" against the wrong endpoint.
 * Their stored configuration is preserved; playback is reported unsupported.
 */
const SUPPORTED_SERVER_VOICE_PROVIDERS = new Set(['kokoro', 'voicevox', 'fish-speech']);

/**
 * Whether this host is loopback. Module-private: the policy decision is
 * `resolveTtsPlan`'s to make, and exporting the predicate would make it a
 * second, independently-callable answer to the same question.
 *
 * A packaged Tauri build's CSP `connect-src` enumerates only the local ports
 * (AC-9), so a non-loopback voice URL would be silently blocked in the
 * webview. Browser builds are unrestricted.
 */
const isLocalhostUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
};

/**
 * Whether a Bearer credential may be sent to this endpoint. HTTPS protects it
 * in transit; plain HTTP does not, so the key is only allowed over loopback,
 * where the request never leaves the machine. A stored connection can hold any
 * URL — nothing upstream validates the protocol — so this is checked at the
 * point of transmission rather than trusted from configuration.
 */
const canCarryCredential = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:' || isLocalhostUrl(url);
  } catch {
    return false;
  }
};

export const resolveTtsPlan = (options: ResolveTtsPlanOptions): TtsPlan => {
  const { mode, serverUrl, providerId, apiKey, isDesktop } = options;

  if (mode === 'disabled') {
    return { kind: 'disabled' };
  }
  if (mode !== 'server' || !serverUrl) {
    return { kind: 'browser' };
  }
  if (providerId && !SUPPORTED_SERVER_VOICE_PROVIDERS.has(providerId)) {
    return {
      kind: 'terminal',
      message:
        `${providerId} is not yet supported by the local speech runtime. The ` +
        'configuration is saved, but voice playback for this provider is unavailable.',
      retryable: false,
    };
  }
  if (apiKey && !canCarryCredential(serverUrl)) {
    return {
      kind: 'terminal',
      message:
        'This voice server needs an API key but is configured over plain http://. ' +
        'Use https:// (or a localhost address) so the key is not sent in the clear.',
      retryable: false,
    };
  }
  if (isDesktop && !isLocalhostUrl(serverUrl)) {
    // Keep the configuration; report the reason instead of letting the CSP
    // produce a bare "blocked by Content Security Policy" failure.
    return { kind: 'browser' };
  }
  return { kind: 'server', url: serverUrl.replace(/\/+$/, ''), apiKey };
};
