// packages/frontend/local-runtime/src/lib/ort_runtime.ts
//
// The single browser-facing seam for the ONNX Runtime Web boundary.
//
// Aikami does NOT bundle the ONNX Runtime WASM binaries. Every `ort-*.wasm`
// is fetched at runtime from the distribution plane (`aikami-dist` →
// `dl.bearlysleeping.com`) under an immutable, version-pinned path:
//
//     <origin>/models/ort/<ORT_RUNTIME_VERSION>/
//
// Why this module exists
// ----------------------
// Three local-ML consumers used to configure ORT inconsistently (Kokoro read
// `PUBLIC_ORT_WASM_URL`, the memory backend hardcoded `/ort/`, the text worker
// configured nothing), and each package-owned copy of ORT eagerly emitted its
// own `ort-*.wasm` into the Cloudflare client `build/`. Cloudflare rejects any
// static asset above 25 MiB, so those emitted binaries broke `wrangler deploy`.
//
// This module centralizes the *configuration* step; the pinned *version* and
// asset *filenames* live in `@aikami/constants` so the publisher script and the
// build guard share them. Paired with the build-time ORT externalization plugin
// (`apps/frontend/client/scripts/ort_external_plugin.ts`), it guarantees no ORT
// WASM is ever emitted into the deployable build.
//
// Contracts: C-389 (browser Kokoro), C-427 (local runtime), C-458 (memory).

import {
  DEFAULT_ORT_DIST_ORIGIN,
  ORT_DIST_PATH,
  ORT_RUNTIME_VERSION,
  ORT_VARIANT_FILES,
  ORT_VARIANTS,
  type OrtVariant,
  ortDistDirectory,
} from '@aikami/constants';

export {
  DEFAULT_ORT_DIST_ORIGIN,
  ORT_DIST_PATH,
  ORT_RUNTIME_VERSION,
  ORT_VARIANT_FILES,
  ORT_VARIANTS,
  type OrtVariant,
  ortDistDirectory,
};

/**
 * `import.meta.env.PUBLIC_ORT_WASM_URL`, typed as optional.
 *
 * Vite replaces `import.meta.env.PUBLIC_ORT_WASM_URL` with the literal value at
 * build time (including inside workers). The cast keeps this module loadable in
 * bare Bun tests, where the key is absent and evaluates to `undefined`.
 *
 * Declared before any consumer so the binding is initialized by the time a
 * resolver runs.
 */
const PUBLIC_ORT_WASM_URL = (import.meta.env as Record<string, string | undefined>)
  .PUBLIC_ORT_WASM_URL;

/**
 * Read the configured ORT base URL.
 *
 * Precedence:
 *  1. an explicit `configured` argument (the client passes
 *     `import.meta.env.PUBLIC_ORT_WASM_URL`),
 *  2. the versioned distribution-plane default.
 *
 * The result is always an absolute, trailing-slash URL under a version
 * directory. A settled answer is required: a directory containing *every*
 * ORT build (the old ambiguous `/ort/` fallback) makes variant selection
 * nondeterministic, which is exactly the regression this module removes.
 */
export const resolveOrtBaseUrl = (configured?: string | undefined): string => {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  const base =
    trimmed.length > 0
      ? trimmed
      : `${DEFAULT_ORT_DIST_ORIGIN}/${ortDistDirectory(ORT_RUNTIME_VERSION)}`;
  return base.endsWith('/') ? base : `${base}/`;
};

/**
 * Explicit per-variant URL mapping for onnxruntime-web's `wasmPaths`.
 *
 * Assigning the object form (rather than a bare directory string) makes variant
 * selection deterministic: onnxruntime resolves exactly the requested mjs/wasm
 * pair instead of probing a directory that contains every build.
 */
export const ortWasmPaths = (baseUrl?: string): { mjs: string; wasm: string } => {
  const base = resolveOrtBaseUrl(baseUrl);
  return {
    mjs: `${base}${ORT_VARIANT_FILES.jsep.mjs}`,
    wasm: `${base}${ORT_VARIANT_FILES.jsep.wasm}`,
  };
};

/**
 * The shape of the ONNX runtime configuration surface shared by
 * `onnxruntime-web` and `@huggingface/transformers`.
 *
 * transformers.js re-exports its own `env` whose `backends.onnx.wasm` object is
 * the very object the ORT runtime reads, so configuring it once on any entry
 * point configures it for the whole worker.
 */
export type OrtConfigurableEnv = {
  backends?: {
    onnx?: {
      wasm?: {
        wasmPaths?: string | { mjs?: string; wasm?: string };
      };
    };
  };
  /** Local model resolution (transformers.js). */
  allowLocalModels?: boolean;
  allowRemoteModels?: boolean;
  localModelPath?: string;
  /** HuggingFace-compatible origin used when remote resolution is enabled. */
  remoteHost?: string;
  /** Path template used to build a remote model file URL. */
  remotePathTemplate?: string;
};

/**
 * Apply the shared ORT runtime configuration to a transformers.js/onnxruntime
 * environment object.
 *
 * This is the one function every local-ML path calls, so there is exactly one
 * place that decides the runtime version and where its assets live.
 *
 * @param env      The transformers.js `env` (or `onnxruntime-web` `env`).
 * @param baseUrl  Optional override base (already resolved); normally omitted
 *                 so `PUBLIC_ORT_WASM_URL` / the versioned default applies.
 */
export const configureOrtRuntime = (
  env: OrtConfigurableEnv,
  baseUrl?: string,
): { baseUrl: string; wasmPaths: { mjs: string; wasm: string } } => {
  const resolvedBase = resolveOrtBaseUrl(baseUrl);
  const paths = ortWasmPaths(resolvedBase);

  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    // Deterministic, version-pinned mapping. Never a bare directory.
    wasm.wasmPaths = paths;
  }

  return { baseUrl: resolvedBase, wasmPaths: paths };
};

/**
 * Configure transformers.js local-model resolution without touching ORT.
 *
 * Weights come from the app-controlled Cache Storage (pre-warmed by the
 * explicit download control), never implicitly from the HuggingFace CDN.
 */
export const configureLocalModelResolution = (
  env: OrtConfigurableEnv,
  options?: { modelPath?: string; allowRemote?: boolean },
): void => {
  env.allowLocalModels = true;
  env.localModelPath = options?.modelPath ?? '/models/';
  env.allowRemoteModels = options?.allowRemote ?? false;
};

/**
 * Resolve model files through canonical remote URLs while still serving the
 * bytes from the app-controlled Cache Storage.
 *
 * Why not `localModelPath`: transformers.js resolves `/models/<repo>/<file>`
 * against the app origin. A static SPA host (Cloudflare, and every Tauri
 * build) answers that path with `index.html`, so a cache miss is not a 404 —
 * it is a 200 carrying HTML, and the first JSON read dies with
 * `Unexpected token '<'`. The pre-warmed entries are therefore keyed by the
 * exact URL transformers.js asks for, which Cache Storage serves offline and
 * a real network only reaches for files the bundle does not carry.
 *
 * @param env       The transformers.js `env`.
 * @param revision  Pinned model revision; never `main`.
 * @param host      Canonical model origin.
 */
export const configurePinnedRemoteModelResolution = (
  env: OrtConfigurableEnv,
  options: { revision: string; host?: string },
): void => {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = options.host ?? 'https://huggingface.co/';
  env.remotePathTemplate = `{model}/resolve/${options.revision}/`;
};

/**
 * Resolve an ORT runtime asset filename to its version-pinned distribution URL.
 *
 * This is the runtime half of the build-time ORT externalization: Vite rewrites
 * package-owned `new URL('ort-wasm-simd-threaded.*', import.meta.url)` asset
 * references into calls to this function, so the request always targets
 * `.../models/ort/<version>/<file>` instead of a hashed `_app/immutable` path.
 *
 * `PUBLIC_ORT_WASM_URL` is read statically so Vite can inject it into both the
 * main-thread and worker bundles; it is optional and falls back to the
 * versioned distribution-plane default.
 *
 * @param filename e.g. `ort-wasm-simd-threaded.jsep.wasm`.
 * @param baseUrl  Optional override base; normally omitted.
 */
export const ortRuntimeAssetUrl = (filename: string, baseUrl?: string): string => {
  const explicit = baseUrl ?? PUBLIC_ORT_WASM_URL;
  return `${resolveOrtBaseUrl(explicit)}${filename}`;
};
