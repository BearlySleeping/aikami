// apps/frontend/client/scripts/ort_external_plugin.ts
//
// Build-time guard that stops Vite from packaging ONNX Runtime binaries.
//
// The problem
// -----------
// `@huggingface/transformers` and `onnxruntime-web` both ship Emscripten glue
// that contains a literal asset reference:
//
//   new URL('ort-wasm-simd-threaded.asyncify.wasm', import.meta.url)
//   new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url)
//
// Vite's `vite:asset-import-meta-url` transform resolves that reference to a
// file, hashes it, and emits it into `build/_app/immutable/assets/`. Because
// the binaries are 21–27 MiB, Cloudflare Workers Static Assets rejects the
// deploy:
//
//   Asset too large. Cloudflare Workers supports assets of up to 25 MiB.
//
// Setting `env.backends.onnx.wasm.wasmPaths` at runtime is NOT enough: Vite
// still owns the `new URL(...)` expression and emits the asset before any
// runtime code runs.
//
// The fix
// -------
// An `enforce: 'pre'` transform runs *before* `vite:asset-import-meta-url` and
// rewrites those ORT asset references into calls to a virtual module that
// resolves the URL from the shared version-pinned ORT runtime definition at
// runtime. No ORT binary is ever resolved by Vite, so none is emitted.
//
// The rewrite is deliberately narrow:
//  - only `ort-wasm-simd-threaded.*` filenames,
//  - only inside modules that import an ORT-bearing package (`transformers`,
//    `kokoro-js`, `onnxruntime-web`),
//  - only `new URL(<literal>, import.meta.url)` (the asset-plugin pattern).
// Everything else — PixiJS, sqlite, fonts, images — is untouched.
//
// `@vite-ignore` is added so Vite/rolldown do not warn about the now-dynamic
// URL expression. Importing the virtual module keeps type safety and works
// inside Web Workers as well as the main thread.

import type { Plugin } from 'vite';

/** Virtual module id that exposes the shared ORT runtime resolver. */
export const ORT_RUNTIME_VIRTUAL_ID = 'virtual:aikami-ort-runtime';

/** Resolved virtual module id (Vite prefixes `\0` for virtual modules). */
const RESOLVED_ORT_RUNTIME_ID = `\0${ORT_RUNTIME_VIRTUAL_ID}`;

/**
 * Matches the literal `new URL('ort-wasm-simd-threaded.<...>.wasm'|'.mjs',
 * import.meta.url)` references in ORT Emscripten glue.
 *
 * Captures the filename so the replacement can pass the variant through to the
 * shared resolver. Only relative single-segment filenames appear in the emitted
 * glue today; the pattern is anchored to exactly that shape to avoid touching
 * unrelated `new URL` calls.
 */
const ORT_NEW_URL_RE =
  /\bnew\s+URL\s*\(\s*(['"])(ort-wasm-simd-threaded\.[a-z0-9.-]+\.(?:wasm|mjs))\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * Packages whose emitted modules may contain the ORT asset reference. The
 * rewrite is skipped for everything else, so a first-party `new URL` is never
 * silently converted.
 */
const ORT_BEARING_PACKAGE_RE =
  /(?:@huggingface[/\\]transformers|kokoro-js|onnxruntime-web|ort-wasm)/;

/**
 * Whether a module id belongs to an ORT-bearing dependency.
 *
 * Transformers.js *inlines* ORT into a single `dist/transformers.web.js`, so
 * matching the package path (not the ORT import itself) is what catches it.
 */
const isOrtBearingModule = (id: string): boolean => ORT_BEARING_PACKAGE_RE.test(id);

/**
 * Vite plugin: externalize ONNX Runtime WASM/MJS asset references.
 *
 * Registered with `enforce: 'pre'` so it runs before
 * `vite:asset-import-meta-url`, which is the plugin that would otherwise
 * resolve and emit the binaries.
 */
export const ortExternalPlugin = (): Plugin => {
  return {
    name: 'aikami:ort-external',
    enforce: 'pre',

    resolveId(id) {
      if (id === ORT_RUNTIME_VIRTUAL_ID) {
        return RESOLVED_ORT_RUNTIME_ID;
      }
      return null;
    },

    load(id) {
      if (id !== RESOLVED_ORT_RUNTIME_ID) {
        return null;
      }
      // Re-export the shared runtime resolver through the workspace alias, so
      // Vite (not Node) resolves the package — the alias exists in this build's
      // resolve configuration and points at the package source.
      return [
        "export { ortRuntimeAssetUrl as __aikamiOrtAssetUrl } from '@aikami/frontend/local-runtime';",
      ].join('\n');
    },

    transform(code, id) {
      // Narrow on the module id first so the regex work only runs for
      // ORT-bearing dependencies.
      if (!isOrtBearingModule(id)) {
        return null;
      }

      // `ORT_NEW_URL_RE` is global; reset before each use so state never leaks
      // between modules.
      ORT_NEW_URL_RE.lastIndex = 0;
      if (!ORT_NEW_URL_RE.test(code)) {
        return null;
      }
      ORT_NEW_URL_RE.lastIndex = 0;

      const rewritten = code.replace(
        ORT_NEW_URL_RE,
        (_match, _quote: string, filename: string) =>
          `new URL(/* @vite-ignore */ __aikamiOrtAssetUrl(${JSON.stringify(filename)}), import.meta.url)`,
      );

      if (rewritten === code) {
        return null;
      }

      // The virtual module import must be present exactly once per module.
      const withImport = `import { __aikamiOrtAssetUrl } from ${JSON.stringify(ORT_RUNTIME_VIRTUAL_ID)};\n${rewritten}`;
      return { code: withImport, map: null };
    },
  };
};
