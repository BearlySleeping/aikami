// packages/frontend/utils/src/lib/browser/webgpu.ts
//
// The ONE WebGPU availability probe.
//
// Every consumer — the Kokoro TTS worker, the local text LLM worker, and the
// start-menu recommendation banner — must agree on what "WebGPU is
// available" means, or the game recommends enabling a feature the runtime
// then silently refuses to use (or hides a recommendation for a feature it
// actually has).
//
// "Supported" deliberately means more than `navigator.gpu !== undefined`:
// a browser exposes `navigator.gpu` whenever the feature is *present*, even
// on a machine where no adapter can be handed out (blocklisted driver,
// headless CI, a GPU that failed to initialize). Requesting the adapter is
// the only honest test, and it must be raced against a timeout so a driver
// that never answers cannot hang the worker that asked.

/**
 * How long an adapter request may take before WebGPU is treated as absent.
 *
 * 3s is deliberately generous — first-time driver initialization on a cold
 * machine can be slow — but bounded: the Kokoro worker runs this probe
 * concurrently with a 92 MB model import, and an unbounded await there is
 * indistinguishable from a hung boot.
 */
const ADAPTER_PROBE_TIMEOUT_MS = 3000;

/** Resolves to `undefined` once the probe budget is spent. */
const timeoutAfter = (ms: number): Promise<undefined> =>
  new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));

/**
 * True when a WebGPU adapter can actually be requested in this context.
 *
 * Safe to call outside a browser (SSR, a Node test runner): a missing
 * `navigator` is reported as unsupported rather than throwing.
 *
 * 🔴 This is the single source of truth. Do NOT re-implement the adapter
 * probe in a worker or a service — import this instead, so a change to the
 * fallback policy lands everywhere at once.
 */
export const isWebGPUSupported = async (): Promise<boolean> => {
  try {
    if (typeof navigator === 'undefined') {
      return false;
    }

    const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } })
      .gpu;
    if (!gpu?.requestAdapter) {
      return false;
    }

    const adapter = await Promise.race([
      gpu.requestAdapter(),
      timeoutAfter(ADAPTER_PROBE_TIMEOUT_MS),
    ]);

    return adapter !== undefined && adapter !== null;
  } catch {
    // Headless CI, blocklisted driver, or adapter request failure — treat
    // WebGPU as absent rather than letting the promise hang.
    return false;
  }
};
