// .pi/extensions/lib/async.ts
//
// Small async primitives shared by polling and long-running tools.

/**
 * Sleep that resolves `true` on normal completion and `false` when the signal
 * aborts (user pressed Esc / Ctrl+C).
 *
 * The abort listener is always removed — polling loops call this hundreds of
 * times per invocation and would otherwise leak listeners onto a signal that
 * lives for the whole tool call.
 */
export const abortableSleep = (ms: number, signal?: AbortSignal): Promise<boolean> => {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  if (ms <= 0) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

/** Formats a millisecond duration as a compact human string: 950ms, 4.2s, 3m12s. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) {
    return '?';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
};
