// apps/frontend/client/src/lib/services/audio/kokoro_server_client.ts
//
// The HTTP half of server-mode TTS: every request the service makes to a
// running Kokoro REST server (OpenAI-compatible speech shape).
//
// Extracted from `tts_service.svelte.ts` so the service owns *state and
// policy* (which backend, when to fall back, what to log) while this module
// owns *wire format*. The two paths — this REST client and the in-browser
// Kokoro worker — are independent engines; keeping their transport code
// apart stops the browser-worker lifecycle from dragging server concerns
// along with it.
//
// Every function is pure with respect to service state: it takes the
// configuration it needs and returns what came back, so the caller decides
// what to record and what to report.

import type { VoiceInfo } from '$types';

/** How long the availability probe may take before it counts as unreachable. */
const PROBE_TIMEOUT_MS = 5000;

/** Connection details for the configured voice server. */
export type KokoroServerConnection = {
  /** Base URL, already normalized (no trailing slash). */
  readonly baseUrl: string;
  /** Bearer credential, or undefined for a keyless server. */
  readonly apiKey: string | undefined;
};

/**
 * Bearer header for the configured voice server, or nothing when keyless.
 *
 * A credential is only ever attached here after the service has verified the
 * endpoint can carry one (see `canCarryCredential` in the service) — this
 * module never decides whether it is safe to send.
 */
const kokoroAuthHeaders = (apiKey: string | undefined): Record<string, string> =>
  // biome-ignore lint/style/useNamingConvention: HTTP header name
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

/**
 * POSTs a synthesis request and returns the WAV bytes.
 *
 * `pitch` (VoiceParams) has no field in the OpenAI-compatible speech request
 * body Kokoro serves and is intentionally left unmapped here.
 *
 * @returns The WAV ArrayBuffer, or `undefined` when the request failed.
 */
export const requestKokoroSpeech = async (options: {
  connection: KokoroServerConnection;
  text: string;
  voice: string;
  /** VoiceParams speed, or undefined to let the server pick its default. */
  speed: number | undefined;
  signal: AbortSignal;
}): Promise<ArrayBuffer | undefined> => {
  const { connection, text, voice, speed, signal } = options;
  const { baseUrl, apiKey } = connection;

  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...kokoroAuthHeaders(apiKey),
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      // biome-ignore lint/style/useNamingConvention: API contract field name
      response_format: 'wav',
      ...(speed !== undefined ? { speed } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    return undefined;
  }

  return await response.arrayBuffer();
};

/**
 * Health-checks the configured server without paying for synthesis.
 *
 * A GET against the voices listing is a real health check with no synthesis
 * cost — probing by POSTing a full speech request paid for audio generation
 * just to learn the server exists. A server that protects `/v1/audio/speech`
 * usually protects `/v1/voices` with the same credential, so the probe
 * carries it: an unauthenticated probe would 401 and be misread as
 * "server unavailable".
 *
 * Never blind-probes ports — only the runtime-configured URL is checked.
 */
export const probeKokoroServer = async (connection: KokoroServerConnection): Promise<boolean> => {
  const { baseUrl, apiKey } = connection;
  try {
    const response = await fetch(`${baseUrl}/v1/voices`, {
      method: 'GET',
      headers: kokoroAuthHeaders(apiKey),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    // Server not reachable at the configured URL.
    return false;
  }
};

/** Fetches the server's voice listing, or undefined when unavailable. */
export const fetchKokoroVoices = async (
  connection: KokoroServerConnection,
): Promise<VoiceInfo[] | undefined> => {
  const { baseUrl, apiKey } = connection;
  const response = await fetch(`${baseUrl}/v1/voices`, {
    headers: kokoroAuthHeaders(apiKey),
  });
  if (!response.ok) {
    return undefined;
  }

  const data = (await response.json()) as { voices?: VoiceInfo[] };
  return Array.isArray(data.voices) && data.voices.length > 0 ? data.voices : undefined;
};
