// apps/frontend/client/src/lib/services/image/engine/image_engine_factory.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock class names mirror the real engine class names
//
// Image engine factory — C-388 AC-1 (grep assertion), AC-3 (wire toggle),
// AC-4 (auto-detection permutations).
//
// Contract: C-388 Image Engine Provider Abstraction

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mutable probe outcomes — read lazily by the mocked engines
let comfyuiHealthy = false;
let sdcppHealthy = false;

// ── Mock the engine modules BEFORE importing the factory ────────────────
mock.module('./comfyui_engine.svelte.ts', () => ({
  ComfyUiEngine: class {
    id = 'comfyui' as const;
    capabilities = {
      negativePrompt: true,
      seed: true,
      sampler: true,
      initImage: true,
      mask: false,
      referenceImages: false,
      controlNet: false,
      lora: false,
      cancel: true,
      progress: true,
    };
    healthCheck = mock(async () => comfyuiHealthy);
    listModels = mock(async () => [{ id: 'model', description: 'Model' }]);
    generate = mock(async () => ({
      blob: new Blob(),
      width: 512,
      height: 512,
      mimeType: 'image/png',
    }));
  },
}));

mock.module('./sdcpp_engine.svelte.ts', () => ({
  SdCppEngine: class {
    id = 'sdcpp' as const;
    capabilities = {
      negativePrompt: true,
      seed: true,
      sampler: true,
      initImage: true,
      mask: true,
      referenceImages: true,
      controlNet: true,
      lora: true,
      cancel: true,
      progress: true,
    };
    healthCheck = mock(async () => sdcppHealthy);
    listModels = mock(async () => [{ id: 'model', description: 'Model' }]);
    generate = mock(async () => ({
      blob: new Blob(),
      width: 512,
      height: 512,
      mimeType: 'image/png',
    }));
  },
}));

const setProbes = (options: { comfyui?: boolean; sdcpp?: boolean }): void => {
  comfyuiHealthy = options.comfyui ?? false;
  sdcppHealthy = options.sdcpp ?? false;
};

type FactoryModule = typeof import('./image_engine_factory.svelte.ts');

describe('image engine factory', () => {
  let factory: FactoryModule;

  beforeEach(async () => {
    setProbes({ comfyui: false, sdcpp: false });
    delete process.env.PUBLIC_IMAGE_ENGINE;
    factory = await import('./image_engine_factory.svelte.ts');
    factory.resetImageEngineCache();
    factory.setImageEngineOverride('auto');
  });

  afterEach(() => {
    setProbes({ comfyui: false, sdcpp: false });
    factory.resetImageEngineCache();
    factory.setImageEngineOverride('auto');
    delete process.env.PUBLIC_IMAGE_ENGINE;
  });

  // ═════════════════════════════════════════════════════════════════════
  // getConfiguredImageEngineId
  // ═════════════════════════════════════════════════════════════════════

  test('getConfiguredImageEngineId defaults to auto', () => {
    expect(factory.getConfiguredImageEngineId()).toBe('auto');
  });

  test('getConfiguredImageEngineId reads PUBLIC_IMAGE_ENGINE', () => {
    process.env.PUBLIC_IMAGE_ENGINE = 'sdcpp';
    expect(factory.getConfiguredImageEngineId()).toBe('sdcpp');
    process.env.PUBLIC_IMAGE_ENGINE = 'comfyui';
    expect(factory.getConfiguredImageEngineId()).toBe('comfyui');
  });

  test('getConfiguredImageEngineId rejects unknown values → auto', () => {
    process.env.PUBLIC_IMAGE_ENGINE = 'banana';
    expect(factory.getConfiguredImageEngineId()).toBe('auto');
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-3: explicit engine toggle changes the wire protocol
  // ═════════════════════════════════════════════════════════════════════

  test('AC-3: PUBLIC_IMAGE_ENGINE=comfyui resolves the ComfyUI engine (no probes)', async () => {
    process.env.PUBLIC_IMAGE_ENGINE = 'comfyui';
    setProbes({ comfyui: false, sdcpp: false }); // probes would fail if called
    const engine = await factory.resolveImageEngine();
    expect(engine?.id).toBe('comfyui');
  });

  test('AC-3: PUBLIC_IMAGE_ENGINE=sdcpp resolves the sd-server engine (no probes)', async () => {
    process.env.PUBLIC_IMAGE_ENGINE = 'sdcpp';
    setProbes({ comfyui: false, sdcpp: false }); // probes would fail if called
    const engine = await factory.resolveImageEngine();
    expect(engine?.id).toBe('sdcpp');
  });

  test('AC-3: runtime override selects sdcpp even when PUBLIC_IMAGE_ENGINE is comfyui', async () => {
    process.env.PUBLIC_IMAGE_ENGINE = 'comfyui';
    factory.setImageEngineOverride('sdcpp');
    const engine = await factory.resolveImageEngine();
    expect(engine?.id).toBe('sdcpp');
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-4: auto-detection permutations
  // ═════════════════════════════════════════════════════════════════════

  test('AC-4: auto — only ComfyUI responds → comfyui', async () => {
    setProbes({ comfyui: true, sdcpp: false });
    const engine = await factory.detectImageEngine();
    expect(engine?.id).toBe('comfyui');
  });

  test('AC-4: auto — only sd-server responds → sdcpp', async () => {
    setProbes({ comfyui: false, sdcpp: true });
    const engine = await factory.detectImageEngine();
    expect(engine?.id).toBe('sdcpp');
  });

  test('AC-4: auto — both respond → sdcpp (deterministic preference)', async () => {
    setProbes({ comfyui: true, sdcpp: true });
    const engine = await factory.detectImageEngine();
    expect(engine?.id).toBe('sdcpp');
  });

  test('AC-4: auto — neither responds → undefined (no throw)', async () => {
    setProbes({ comfyui: false, sdcpp: false });
    const engine = await factory.detectImageEngine();
    expect(engine).toBeUndefined();
  });

  test('AC-4: detection result is cached per session', async () => {
    setProbes({ comfyui: true, sdcpp: false });
    const first = await factory.detectImageEngine();
    // Flip the probes — cache should win on the second call
    setProbes({ comfyui: false, sdcpp: true });
    const second = await factory.detectImageEngine();
    expect(first?.id).toBe('comfyui');
    expect(second?.id).toBe('comfyui');
  });

  test('AC-4: resetImageEngineCache clears the cache', async () => {
    setProbes({ comfyui: true, sdcpp: false });
    await factory.detectImageEngine();
    setProbes({ comfyui: false, sdcpp: true });
    factory.resetImageEngineCache();
    const engine = await factory.detectImageEngine();
    expect(engine?.id).toBe('sdcpp');
  });
});

// ═════════════════════════════════════════════════════════════════════
// AC-1: single ComfyUI implementation (grep assertion)
// ═════════════════════════════════════════════════════════════════════

// engine → image → services → lib → src → client → frontend → apps → root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../..');

describe('AC-1: single ComfyUI implementation', () => {
  const GraphNodes = ['CheckpointLoaderSimple', 'KSampler'];
  const TransportLiterals = [
    'class_type',
    "'/prompt'",
    "'/object_info'",
    "'/history'",
    "'/view'",
    "'/api/image'",
  ];

  const clientSrc = resolve(repoRoot, 'apps/frontend/client/src/lib');

  const sourceFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          out.push(full);
        }
      }
    };
    walk(clientSrc);
    return out;
  };

  test('exactly one non-test source file contains the ComfyUI graph node names', () => {
    const hits = sourceFiles().filter((file) => {
      const content = readFileSync(file, 'utf8');
      return GraphNodes.some((node) => content.includes(node));
    });
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('engine/comfyui_engine');
  });

  test('the three rewritten files contain no ComfyUI transport literals', () => {
    const files = [
      resolve(clientSrc, 'services/image/image_generation_service.svelte.ts'),
      resolve(clientSrc, 'views/dev/image/image_view_model.svelte.ts'),
      resolve(clientSrc, 'views/character/persona/create/persona_create_view_model.svelte.ts'),
    ];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const literal of TransportLiterals) {
        expect(content).not.toContain(literal);
      }
    }
  });

  test('the engine adapter is the single file with the ComfyUI transport', () => {
    const engineFile = resolve(clientSrc, 'services/image/engine/comfyui_engine.svelte.ts');
    const content = readFileSync(engineFile, 'utf8');
    expect(content).toContain('/prompt');
    expect(content).toContain('/object_info');
    expect(content).toContain('/history/');
    expect(content).toContain('/upload/image');
  });
});
