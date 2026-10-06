// packages/frontend/local-runtime/src/lib/ort_runtime.test.ts
import { describe, expect, test } from 'bun:test';
import { ORT_RUNTIME_VERSION, ortWasmPaths, resolveOrtBaseUrl } from './ort_runtime.ts';

// Check the installed glue, not just a mocked runtime configuration surface.
describe('ORT native WebGPU ABI', () => {
  test('selected glue exports the API the installed backend calls', async () => {
    const transformers = Bun.resolveSync('@huggingface/transformers', import.meta.dir);
    const runtime = Bun.resolveSync('onnxruntime-web', transformers);
    const root = runtime.slice(0, runtime.lastIndexOf('/dist/') + 1);
    const metadata = await Bun.file(`${root}package.json`).json();
    expect(metadata.version).toBe(ORT_RUNTIME_VERSION);
    const filename = new URL(ortWasmPaths().mjs).pathname.split('/').at(-1);
    const glue = await Bun.file(`${root}dist/${filename}`).text();
    expect(glue).toContain('.webgpuInit=');
    const legacy = await Bun.file(`${root}dist/ort-wasm-simd-threaded.jsep.mjs`).text();
    expect(legacy).not.toContain('.webgpuInit=');
  });
  test('rejects staging override with mismatched ORT version before initialization', () => {
    expect(() => resolveOrtBaseUrl('https://dl.bearlysleeping.com/models/ort/1.27.0/')).toThrow(
      'ORT runtime version mismatch',
    );
  });
});
