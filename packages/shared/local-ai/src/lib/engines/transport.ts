// packages/shared/local-ai/src/lib/engines/transport.ts
//
// Framework-agnostic transport helpers shared by every generation engine
// adapter (C-510). Plain TS: no Svelte runes, no DOM-only globals, no
// Node/Bun-only imports — this package's public entry point must stay
// portable (C-391 AC-0).
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

/** Encoded-payload cap — fail fast instead of stalling on huge uploads. */
export const MAX_BASE64_PAYLOAD_BYTES = 25 * 1024 * 1024;

/** Per-request timeout — a hung engine must not stall a fetch forever. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Decodes base64 to bytes without `Buffer` — the Bun CLI and the browser must
 * share one implementation. Uses `atob` when present (both runtimes provide
 * it) and falls back to a pure-JS decoder otherwise.
 */
export const base64ToBytes = (base64: string): Uint8Array => {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return _decodeBase64Pure(base64);
};

const _BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const _decodeBase64Pure = (base64: string): Uint8Array => {
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((cleaned.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const char of cleaned) {
    const value = _BASE64_ALPHABET.indexOf(char);
    if (value < 0) {
      continue;
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (accumulator >> bits) & 0xff;
    }
  }
  return offset === length ? bytes : bytes.subarray(0, offset);
};

/** Splits a data URL into its MIME type and base64 payload. */
export const splitDataUrl = (dataUrl: string): { mimeType: string; base64: string } => {
  if (!dataUrl.startsWith('data:')) {
    return { mimeType: 'image/png', base64: dataUrl };
  }
  const commaIndex = dataUrl.indexOf(',');
  const meta = commaIndex === -1 ? dataUrl.slice(5) : dataUrl.slice(5, commaIndex);
  const base64 = commaIndex === -1 ? '' : dataUrl.slice(commaIndex + 1);
  return { mimeType: meta.split(';')[0] || 'image/png', base64 };
};

/** Decodes a data URL or raw base64 payload into bytes + MIME type. */
export const decodeImagePayload = (
  payload: string,
  fallbackMimeType = 'image/png',
): { bytes: Uint8Array; mimeType: string } => {
  const { mimeType, base64 } = splitDataUrl(payload);
  return {
    bytes: base64ToBytes(base64),
    mimeType: payload.startsWith('data:') ? mimeType : fallbackMimeType,
  };
};

/** True when a string looks like inline image data (data URL or base64). */
const MIN_IMAGE_STRING_LENGTH = 64;

const isBase64Like = (value: string): boolean => {
  if (value.length === 0 || value.includes(' ')) {
    return false;
  }
  return /^[A-Za-z0-9+/]+=*$/.test(value.slice(0, 4096));
};

export const isImageString = (value: string): boolean => {
  if (value.startsWith('data:')) {
    return true;
  }
  // Short state strings such as "queued" must not be mistaken for image data.
  return isBase64Like(value) && value.length >= MIN_IMAGE_STRING_LENGTH;
};

/** Throws when an encoded payload exceeds {@link MAX_BASE64_PAYLOAD_BYTES}. */
export const assertPayloadSize = (dataUrl: string): void => {
  if (dataUrl.length > MAX_BASE64_PAYLOAD_BYTES) {
    throw new Error(
      `Generation payload too large (${(dataUrl.length / 1024 / 1024).toFixed(1)} MB) — cap is ${MAX_BASE64_PAYLOAD_BYTES / 1024 / 1024} MB`,
    );
  }
};

/** Throws a distinguishable `AbortError` when the signal has already fired. */
export const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
};

/** True when an error is an abort (caller cancellation), not a timeout. */
export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: string } | undefined)?.name === 'AbortError';

/** True when an error came from a request timeout rather than a caller abort. */
export const isTimeoutError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'TimeoutError'
    : (error as { name?: string } | undefined)?.name === 'TimeoutError';

/**
 * Combines the caller signal with a hard per-request timeout. Caller
 * cancellation is preserved via `AbortSignal.any` (AbortError), while a
 * timeout aborts with TimeoutError so a poll loop can tell them apart.
 */
export const withRequestTimeout = (
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

/** Abortable sleep. Resolves immediately when the signal fires. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Wraps bytes in a `Blob` without leaking the source view's `ArrayBufferLike`
 * type. `new Blob([bytes])` is rejected by TS when the view may be backed by a
 * `SharedArrayBuffer`, so the bytes are copied into a fresh `ArrayBuffer`-backed
 * view first — one copy, at the boundary where a Blob is required.
 */
export const bytesToBlob = (bytes: Uint8Array, mimeType: string): Blob => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: mimeType });
};

/**
 * Validates an engine base URL. Only `http(s)` is accepted — a compromised
 * config must not be able to exfiltrate via `file:`/`data:`/`javascript:`.
 * Relative same-origin paths (the Vite dev proxy) are allowed.
 */
export const assertSafeBaseUrl = (baseUrl: string, engineName: string): void => {
  if (baseUrl.startsWith('/') && !baseUrl.startsWith('//')) {
    return;
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error(
      `[${engineName}] Invalid base URL "${baseUrl}" — only http(s) or a relative /api path is allowed`,
    );
  }
};

/** Normalises a base URL: trims whitespace, strips trailing slashes. */
export const normaliseBaseUrl = (baseUrl: string | undefined): string => {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
};
