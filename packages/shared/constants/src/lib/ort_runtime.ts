// packages/shared/constants/src/lib/ort_runtime.ts
//
// The single source of truth for the ONNX Runtime Web version and the
// distribution-plane layout that serves its WASM/MJS assets.
//
// Aikami never bundles ONNX Runtime binaries: they are fetched at runtime from
// the `aikami-dist` R2 plane (`dl.bearlysleeping.com`) under an immutable,
// version-pinned directory:
//
//     <origin>/models/ort/<ORT_RUNTIME_VERSION>/
//
// Why this lives in `@aikami/constants`
// -------------------------------------
// The version is consumed by three very different call sites:
//   - the browser runtime seam (`@aikami/frontend/local-runtime`),
//   - the Cloudflare client Vite build,
//   - the `scripts/src/lib/dist/upload_ort.ts` publisher that fills the bucket.
// A dependency-free shared constant is the only place all three can agree on
// the same value without pulling browser or Node code into each other.
//
// Version discipline: `ORT_RUNTIME_VERSION` MUST equal the `onnxruntime-web`
// version that `@huggingface/transformers` inlines. transformers.js owns the
// Emscripten glue it calls into, so a WASM built for a different ORT release is
// not a supported pairing. `check_ort_runtime.ts` enforces the equality.

/**
 * The exact onnxruntime-web release the whole app runs on.
 *
 * Keep in lockstep with:
 *  - the root `overrides.onnxruntime-web` pin,
 *  - the `onnxruntime-web` dependency in `apps/frontend/client`,
 *  - the objects published to `models/ort/<version>/` on `aikami-dist`.
 */
export const ORT_RUNTIME_VERSION = '1.31.0-dev.20260914-8d85527a0';

/** Canonical distribution-plane origin for ORT runtime assets. */
export const DEFAULT_ORT_DIST_ORIGIN = 'https://dl.bearlysleeping.com';

/** Immutable dist path prefix for ORT runtime assets. */
export const ORT_DIST_PATH = 'models/ort';

/**
 * The ORT WASM/MJS variants Aikami publishes and can request at runtime.
 *
 * - `jsep` — legacy JavaScript execution-provider glue (jsepInit). It is
 *   not ABI-compatible with the pinned runtime's native WebGPU provider,
 *   which calls webgpuInit. Kept published for legacy JSEP consumers.
 * - `asyncify` — native-WebGPU-capable glue exposing webgpuInit, also usable
 *   by the plain WASM backend. The shared seam selects this complete pair.
 *
 * ORT also ships native-WebGPU JSPI glue, but it requires browser WebAssembly
 * JSPI support. Aikami neither selects nor publishes that capability-specific
 * variant; asyncify avoids making JSPI a browser prerequisite.
 */
export const ORT_VARIANTS = ['jsep', 'asyncify'] as const;

/** A supported ONNX Runtime Web assembly variant. */
export type OrtVariant = (typeof ORT_VARIANTS)[number];

/** The filenames onnxruntime-web resolves for each variant. */
export const ORT_VARIANT_FILES: Readonly<
  Record<OrtVariant, { readonly mjs: string; readonly wasm: string }>
> = {
  jsep: {
    mjs: 'ort-wasm-simd-threaded.jsep.mjs',
    wasm: 'ort-wasm-simd-threaded.jsep.wasm',
  },
  asyncify: {
    mjs: 'ort-wasm-simd-threaded.asyncify.mjs',
    wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
  },
};

/** Every published ORT runtime filename, both variants and both kinds. */
export const ORT_RUNTIME_FILES: readonly string[] = ORT_VARIANTS.flatMap((variant) => [
  ORT_VARIANT_FILES[variant].mjs,
  ORT_VARIANT_FILES[variant].wasm,
]);

/**
 * Build the immutable distribution-plane directory for a version.
 *
 * @param version Defaults to {@link ORT_RUNTIME_VERSION}.
 */
export const ortDistDirectory = (version: string = ORT_RUNTIME_VERSION): string =>
  `${ORT_DIST_PATH}/${version}/`;
