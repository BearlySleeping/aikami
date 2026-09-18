// apps/frontend/client/tests/ort_runtime_seam.test.ts
//
// Focused tests for the two halves of the ORT externalization boundary:
//   - scripts/ort_external_plugin.ts — the build-time rewrite that stops Vite
//     from emitting ort-*.wasm into the deployable build.
//   - packages/frontend/local-runtime/src/lib/ort_runtime.ts — the runtime
//     resolvers that point ORT at the version-pinned `aikami-dist` plane.
//
// These pin the exact rewrite shape (so a refactor cannot silently let Vite
// resolve a 27 MiB asset again) and the base-URL precedence/trailing-slash
// contract every consumer depends on.

import { describe, expect, test } from 'bun:test';
import {
  configureOrtRuntime,
  DEFAULT_ORT_DIST_ORIGIN,
  ortRuntimeAssetUrl,
  ortWasmPaths,
  resolveOrtBaseUrl,
} from '@aikami/frontend/local-runtime';
import { ORT_RUNTIME_VIRTUAL_ID, ortExternalPlugin } from '../scripts/ort_external_plugin.ts';

/** Runs the plugin's transform hook with a fake module id. */
const transform = (code: string, id: string): { code: string } | null => {
  const plugin = ortExternalPlugin();
  const hook = plugin.transform;
  if (typeof hook !== 'function') {
    throw new Error('expected a function transform hook');
  }
  // The hook is `(code, id)`; call it directly.
  return hook.call({} as never, code, id) as { code: string } | null;
};

const TRANSFORMERS_ID =
  'node_modules/.bun/@huggingface+transformers@4.3.0/node_modules/@huggingface/transformers/dist/transformers.web.js';

describe('ortExternalPlugin transform', () => {
  test('rewrites a jsep wasm new URL into the shared resolver', () => {
    const source = "const w = new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url);";
    const result = transform(source, TRANSFORMERS_ID);
    expect(result).not.toBeNull();
    expect(result?.code).toContain('__aikamiOrtAssetUrl("ort-wasm-simd-threaded.jsep.wasm")');
    expect(result?.code).toContain('/* @vite-ignore */');
    expect(result?.code).not.toContain("new URL('ort-wasm-simd-threaded.jsep.wasm'");
  });

  test('rewrites the asyncify mjs glue reference', () => {
    const source = 'const m = new URL("ort-wasm-simd-threaded.asyncify.mjs", import.meta.url);';
    const result = transform(source, TRANSFORMERS_ID);
    expect(result?.code).toContain('__aikamiOrtAssetUrl("ort-wasm-simd-threaded.asyncify.mjs")');
  });

  test('adds exactly one virtual-module import', () => {
    const source = [
      "new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url);",
      "new URL('ort-wasm-simd-threaded.asyncify.wasm', import.meta.url);",
    ].join('\n');
    const result = transform(source, TRANSFORMERS_ID);
    const importLine = `import { __aikamiOrtAssetUrl } from ${JSON.stringify(ORT_RUNTIME_VIRTUAL_ID)};`;
    expect(result?.code.split(importLine).length - 1).toBe(1);
  });

  test('leaves non-ORT new URL references untouched in ORT modules', () => {
    const source = "const i = new URL('assets/logo.png', import.meta.url);";
    expect(transform(source, TRANSFORMERS_ID)).toBeNull();
  });

  test('does not rewrite new URL references in first-party modules', () => {
    const source = "const w = new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url);";
    expect(transform(source, 'src/lib/services/audio/kokoro_worker.ts')).toBeNull();
  });

  test('does not rewrite a bare filename without new URL', () => {
    const source = "const name = 'ort-wasm-simd-threaded.jsep.wasm';";
    expect(transform(source, TRANSFORMERS_ID)).toBeNull();
  });
});

describe('ortExternalPlugin resolveId/load', () => {
  test('resolves and loads the virtual module', () => {
    const plugin = ortExternalPlugin();
    const resolved = (plugin.resolveId as (id: string) => string | null).call(
      {} as never,
      ORT_RUNTIME_VIRTUAL_ID,
    );
    expect(resolved).toBe(`\0${ORT_RUNTIME_VIRTUAL_ID}`);

    const loaded = (plugin.load as (id: string) => string | null).call(
      {} as never,
      resolved as string,
    );
    expect(loaded).toContain('ortRuntimeAssetUrl');
    expect(loaded).toContain('@aikami/frontend/local-runtime');
  });

  test('ignores unrelated ids', () => {
    const plugin = ortExternalPlugin();
    expect(
      (plugin.resolveId as (id: string) => string | null).call({} as never, 'pixi.js'),
    ).toBeNull();
    expect((plugin.load as (id: string) => string | null).call({} as never, 'pixi.js')).toBeNull();
  });
});

describe('resolveOrtBaseUrl', () => {
  test('defaults to the version-pinned distribution-plane directory', () => {
    const url = resolveOrtBaseUrl();
    expect(url.startsWith(`${DEFAULT_ORT_DIST_ORIGIN}/models/ort/`)).toBe(true);
    expect(url.endsWith('/')).toBe(true);
    expect(url).toContain('1.31.0-dev');
  });

  test('uses an explicit override', () => {
    expect(resolveOrtBaseUrl('https://cdn.example.com/ort/')).toBe('https://cdn.example.com/ort/');
  });

  test('appends a trailing slash when the override omits it', () => {
    expect(resolveOrtBaseUrl('https://cdn.example.com/ort')).toBe('https://cdn.example.com/ort/');
  });

  test('trims surrounding whitespace on the override', () => {
    expect(resolveOrtBaseUrl('  https://cdn.example.com/ort  ')).toBe(
      'https://cdn.example.com/ort/',
    );
  });

  test('falls back to the pinned default for an empty override', () => {
    expect(resolveOrtBaseUrl('   ')).toBe(resolveOrtBaseUrl());
  });
});

describe('ortWasmPaths', () => {
  test('maps the jsep mjs/wasm pair under the resolved base', () => {
    const base = resolveOrtBaseUrl();
    expect(ortWasmPaths()).toEqual({
      mjs: `${base}ort-wasm-simd-threaded.jsep.mjs`,
      wasm: `${base}ort-wasm-simd-threaded.jsep.wasm`,
    });
  });

  test('honours an override base', () => {
    expect(ortWasmPaths('https://cdn.example.com/o')).toEqual({
      mjs: 'https://cdn.example.com/o/ort-wasm-simd-threaded.jsep.mjs',
      wasm: 'https://cdn.example.com/o/ort-wasm-simd-threaded.jsep.wasm',
    });
  });
});

describe('ortRuntimeAssetUrl', () => {
  test('resolves a package filename to the pinned dist URL', () => {
    const url = ortRuntimeAssetUrl('ort-wasm-simd-threaded.asyncify.wasm');
    expect(url).toBe(`${resolveOrtBaseUrl()}ort-wasm-simd-threaded.asyncify.wasm`);
  });

  test('never yields a hashed _app/immutable path', () => {
    const url = ortRuntimeAssetUrl('ort-wasm-simd-threaded.jsep.wasm');
    expect(url).not.toContain('_app/immutable');
    expect(url).toContain('/models/ort/');
  });
});

describe('configureOrtRuntime', () => {
  test('writes a deterministic object wasmPaths, never a bare directory', () => {
    const env = { backends: { onnx: { wasm: {} as Record<string, unknown> } } };
    const result = configureOrtRuntime(env);
    const wasmPaths = env.backends.onnx.wasm.wasmPaths;
    expect(typeof wasmPaths).toBe('object');
    expect((wasmPaths as { wasm: string }).wasm).toContain('ort-wasm-simd-threaded.jsep.wasm');
    expect(result.baseUrl).toBe(resolveOrtBaseUrl());
  });

  test('is a no-op on env without an onnx backends surface', () => {
    const env = {};
    expect(() => configureOrtRuntime(env)).not.toThrow();
  });
});
