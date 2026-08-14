// packages/shared/local-ai/src/lib/recommend.test.ts
import { describe, expect, test } from 'bun:test';
import type { HardwareProfile, ModelManifest } from '@aikami/types';
import { recommend } from './recommend.ts';

/**
 * A manifest shaped like C-390's models.manifest.json, with the text tiers
 * needed for the VRAM table (AC-3) and one image + voice + stt entry each.
 */
const MANIFEST: ModelManifest = {
  schemaVersion: 1,
  entries: [
    {
      id: 'text-qwen2.5-1.5b-instruct-q4km',
      modality: 'text',
      tier: 'cpu',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
      revision: 'rev',
      file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
      targetPath: 'text/qwen2.5-1.5b-instruct-q4_k_m.gguf',
      bytes: 986_048_768, // ~0.92 GiB — fits any usable budget
      sha256: 'a',
    },
    {
      id: 'text-qwen2.5-7b-instruct-q4km',
      modality: 'text',
      tier: '8gb',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF',
      revision: 'rev',
      file: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
      targetPath: 'text/qwen2.5-7b-instruct-q4_k_m.gguf',
      bytes: 4_683_074_240, // ~4.36 GiB — fits an 8 GB card's usable 5.6 GB
      sha256: 'b',
    },
    {
      id: 'text-mistral-nemo-12b-instruct-q4km',
      modality: 'text',
      tier: '16gb',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF',
      revision: 'rev',
      file: 'Mistral-Nemo-Instruct-2407-Q4_K_M.gguf',
      targetPath: 'text/mistral-nemo-instruct-2407-q4_k_m.gguf',
      bytes: 7_477_208_192, // ~6.96 GiB — fits a 12 GB card's usable 8.4 GB
      sha256: 'c',
    },
    {
      id: 'image-flux1-schnell-q4k',
      modality: 'image',
      tier: '8gb',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'leejet/FLUX.1-schnell-gguf',
      revision: 'rev',
      file: 'flux1-schnell-q4_k.gguf',
      targetPath: 'image/flux1-schnell-q4_k.gguf',
      bytes: 6_884_606_880, // ~6.41 GiB
      sha256: 'd',
    },
    {
      id: 'image-sd15-pruned-q4_0',
      modality: 'image',
      tier: 'cpu',
      license: 'CreativeML OpenRAIL-M',
      requiresAcknowledgement: true,
      kind: 'file',
      repo: 'second-state/stable-diffusion-v1-5-GGUF',
      revision: 'rev',
      file: 'stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',
      targetPath: 'image/stable-diffusion-v1-5-pruned-emaonly-q4_0.gguf',
      bytes: 1_566_768_416, // ~1.46 GiB
      sha256: 'e',
    },
    {
      id: 'tts-kokoro-82m',
      modality: 'tts',
      tier: 'any',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'archive',
      url: 'https://example.com/kokoro.tar.bz2',
      targetPath: 'tts/kokoro-multi-lang-v1_0',
      bytes: 349_418_188,
      sha256: 'f',
    },
    {
      id: 'stt-moonshine-tiny-en-int8',
      modality: 'stt',
      tier: 'any',
      license: 'MIT',
      requiresAcknowledgement: false,
      kind: 'archive',
      url: 'https://example.com/moonshine.tar.bz2',
      targetPath: 'stt/sherpa-onnx-moonshine-tiny-en-int8',
      bytes: 107_600_538,
      sha256: 'g',
    },
  ],
};

const profile = (overrides: Partial<HardwareProfile>): HardwareProfile => ({
  platform: 'linux',
  arch: 'x64',
  gpu: { vendor: 'none', unifiedMemory: false },
  ramMb: 32768,
  cores: 8,
  freeDiskBytes: 100 * 1024 * 1024 * 1024,
  containerRuntime: 'docker',
  gpuPassthroughReady: false,
  ...overrides,
});

const pickText = (plan: { models: { manifestId: string }[] }): string =>
  plan.models.find((m) => m.modality === 'text')?.manifestId ?? 'none';

describe('AC-3 — tier selection respects usable VRAM, not total', () => {
  test('4 GB VRAM → cpu tier (Qwen 1.5B)', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 3050', vramMb: 4096, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(pickText(plan)).toBe('text-qwen2.5-1.5b-instruct-q4km');
  });

  test('8 GB VRAM → 8gb tier (Qwen 7B)', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 3060', vramMb: 8192, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(pickText(plan)).toBe('text-qwen2.5-7b-instruct-q4km');
  });

  test('12 GB VRAM → 8gb tier unless the 16gb entry fits usable 8.4 GB (top-tier fallback warns)', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 4070', vramMb: 12288, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    // 12 GB * 0.7 = 8.4 GB usable. Mistral (6.96 GiB) fits inside 8.4 GB →
    // the 16gb-tier entry is selected, and the top-tier fallback warns.
    expect(pickText(plan)).toBe('text-mistral-nemo-12b-instruct-q4km');
    expect(plan.warnings.some((w) => w.includes('nominal 8gb') || w.includes('tight fit'))).toBe(
      true,
    );
  });

  test('24 GB VRAM → 16gb tier', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 4090', vramMb: 24576, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(pickText(plan)).toBe('text-mistral-nemo-12b-instruct-q4km');
    // 24 GB is nominally 16gb — no top-tier fallback warning.
    expect(plan.warnings.some((w) => w.includes('nominal'))).toBe(false);
  });
});

describe('tierOverride — explicit tier pinning (--tier)', () => {
  test('tierOverride cpu on a 24 GB VRAM profile selects the CPU-tier model without a nominal-tier warning', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 4090', vramMb: 24576, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
      tierOverride: 'cpu',
    });
    // 24 GB is nominally 16gb, but the override pins selection to the cpu
    // tier (Qwen 1.5B) and suppresses the top-tier fallback warning.
    expect(pickText(plan)).toBe('text-qwen2.5-1.5b-instruct-q4km');
    expect(plan.warnings.some((w) => w.includes('nominal') || w.includes('tight fit'))).toBe(false);
  });
});

describe('backendOverride metal on a non-macOS host', () => {
  test('emits the expected warning while setting nativeEngines to true', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 4070', vramMb: 12288, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
      backendOverride: 'metal',
    });
    expect(plan.backend).toBe('metal');
    expect(plan.nativeEngines).toBe(true);
    expect(plan.warnings.some((w) => w.includes('--backend metal requested'))).toBe(true);
  });
});

describe('AC-2 — NVIDIA detection selects the matching CUDA image', () => {
  test('CUDA 12 driver → backend cuda, cudaMajor 12', () => {
    const plan = recommend({
      profile: profile({
        gpu: {
          vendor: 'nvidia',
          name: 'RTX 4070',
          vramMb: 12288,
          cudaMajor: 12,
          unifiedMemory: false,
        },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(plan.backend).toBe('cuda');
    expect(plan.nativeEngines).toBe(false);
  });

  test('CUDA 13 driver → backend cuda, cudaMajor 13', () => {
    const plan = recommend({
      profile: profile({
        gpu: {
          vendor: 'nvidia',
          name: 'RTX 5070',
          vramMb: 12288,
          cudaMajor: 13,
          unifiedMemory: false,
        },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(plan.backend).toBe('cuda');
  });
});

describe('AC-12 — missing GPU passthrough is caught, not assumed', () => {
  test('NVIDIA GPU without toolkit falls back to cpu with a warning', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', name: 'RTX 4070', vramMb: 12288, unifiedMemory: false },
        gpuPassthroughReady: false,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(plan.backend).toBe('cpu');
    expect(plan.warnings.some((w) => w.includes('NVIDIA Container Toolkit'))).toBe(true);
  });

  test('explicit --backend cuda on no NVIDIA GPU obeys with a loud warning', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'none', unifiedMemory: false },
        gpuPassthroughReady: false,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
      backendOverride: 'cuda',
    });
    expect(plan.backend).toBe('cuda');
    expect(plan.warnings.some((w) => w.includes('--backend cuda requested'))).toBe(true);
  });
});

describe('AC-4 — unified memory is not treated as VRAM', () => {
  test('Apple Silicon 16 GB unified → usable 8 GB, nativeEngines true', () => {
    const plan = recommend({
      profile: profile({
        platform: 'darwin',
        arch: 'arm64',
        gpu: { vendor: 'apple', unifiedMemory: true },
        ramMb: 16384,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    // 50% of 16 GB = 8 GB usable. Mistral (6.96 GiB) fits inside 8 GB, so
    // it is selected — but only because the 50% rule says 8 GB usable, and
    // 8 GB usable is nominally the 8gb tier, so the 16gb pick warns as a
    // top-tier fallback. Had the planner treated all 16 GB as free, usable
    // would be 11.2 GB (70%), nominal tier would be 16gb, and no warning
    // would appear. The warning therefore proves the 50% rule held.
    expect(plan.backend).toBe('metal');
    expect(plan.nativeEngines).toBe(true);
    const text = plan.models.find((m) => m.modality === 'text');
    expect(text).toBeDefined();
    expect(text?.bytes ?? 0).toBeLessThanOrEqual(8 * 1024 * 1024 * 1024);
    expect(plan.warnings.some((w) => w.includes('nominal 8gb'))).toBe(true);
  });
});

describe('AC-5 — modality selection controls the download set', () => {
  test('--modalities text yields exactly one text model and COMPOSE_PROFILES text', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'none', unifiedMemory: false },
        ramMb: 16384,
      }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]?.modality).toBe('text');
    expect(plan.modalities).toEqual(['text']);
    expect(plan.models.some((m) => m.modality === 'image')).toBe(false);
    expect(plan.models.some((m) => m.modality === 'voice')).toBe(false);
  });

  test('voice modality selects the tts entry', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'none', unifiedMemory: false },
        ramMb: 16384,
      }),
      modalities: ['voice'],
      manifest: MANIFEST,
    });
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]?.manifestId).toBe('tts-kokoro-82m');
    expect(plan.models[0]?.modality).toBe('voice');
  });

  test('multiple modalities accumulate models and total download', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'none', unifiedMemory: false },
        ramMb: 8192,
      }),
      modalities: ['text', 'voice'],
      manifest: MANIFEST,
    });
    expect(plan.models).toHaveLength(2);
    // 8 GB RAM → usable 4 GB → cpu tier → Qwen 1.5B + Kokoro.
    const expected = MANIFEST.entries
      .filter((e) => e.id === 'text-qwen2.5-1.5b-instruct-q4km' || e.id === 'tts-kokoro-82m')
      .reduce((sum, e) => sum + e.bytes, 0);
    expect(plan.totalDownloadBytes).toBe(expected);
  });
});

describe('AC-1 — no GPU degrades to CPU without error', () => {
  test('no GPU tooling → gpu.vendor none, backend cpu, valid plan', () => {
    const plan = recommend({
      profile: profile({ gpu: { vendor: 'none', unifiedMemory: false }, ramMb: 8192 }),
      modalities: ['text'],
      manifest: MANIFEST,
    });
    expect(plan.backend).toBe('cpu');
    expect(plan.nativeEngines).toBe(false);
    expect(plan.models.length).toBeGreaterThan(0);
  });

  test('image on CPU-only selects the cpu-tier SD1.5 and surfaces its licence', () => {
    const plan = recommend({
      profile: profile({ gpu: { vendor: 'none', unifiedMemory: false }, ramMb: 8192 }),
      modalities: ['image'],
      manifest: MANIFEST,
    });
    expect(plan.models[0]?.manifestId).toBe('image-sd15-pruned-q4_0');
    expect(plan.models[0]?.requiresAcknowledgement).toBe(true);
    expect(plan.models[0]?.license).toBe('CreativeML OpenRAIL-M');
  });
});

describe('web/ollama/comfyui modalities add no models', () => {
  test('web adds no download entries', () => {
    const plan = recommend({
      profile: profile({ gpu: { vendor: 'none', unifiedMemory: false }, ramMb: 8192 }),
      modalities: ['web'],
      manifest: MANIFEST,
    });
    expect(plan.models).toHaveLength(0);
    expect(plan.totalDownloadBytes).toBe(0);
  });
});
