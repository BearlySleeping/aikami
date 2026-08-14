/**
 * apps/backend/local-stack/stack/recommend.test.ts
 *
 * C-391 recommendation ACs exercised at the local-stack level (evidence
 * files named in the contract matrix): AC-3 VRAM table, AC-4 Apple profile,
 * AC-5 modality selection. The pure function lives in @aikami/local-ai;
 * these tests drive it with the same manifest the stack ships.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { HardwareProfile } from '@aikami/local-ai';
import { loadManifest, recommend } from '@aikami/local-ai';
import { probeExecutor } from './probe_executor.ts';

const manifest = await loadManifest({
  executor: probeExecutor,
  path: join(import.meta.dir, 'models.manifest.json'),
});

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

const pickText = (plan: { models: { manifestId: string; modality: string }[] }): string =>
  plan.models.find((m) => m.modality === 'text')?.manifestId ?? 'none';

describe('AC-3 — tier selection respects usable VRAM (shipped manifest)', () => {
  test('4 GB → cpu tier (Qwen 1.5B)', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', vramMb: 4096, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest,
    });
    expect(pickText(plan)).toBe('text-qwen2.5-1.5b-instruct-q4km');
  });

  test('8 GB → 8gb tier (Qwen 7B)', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', vramMb: 8192, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest,
    });
    expect(pickText(plan)).toBe('text-qwen2.5-7b-instruct-q4km');
  });

  test('12 GB → 16gb tier entry fits usable 8.4 GB (top-tier fallback warns)', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', vramMb: 12288, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest,
    });
    // Mistral-Nemo (6.96 GiB) fits inside 12 GB * 0.7 = 8.4 GB usable.
    expect(pickText(plan)).toBe('text-mistral-nemo-12b-instruct-q4km');
    expect(plan.warnings.some((w) => w.includes('nominal') || w.includes('tight fit'))).toBe(true);
  });

  test('24 GB → 16gb tier', () => {
    const plan = recommend({
      profile: profile({
        gpu: { vendor: 'nvidia', vramMb: 24576, unifiedMemory: false },
        gpuPassthroughReady: true,
      }),
      modalities: ['text'],
      manifest,
    });
    expect(pickText(plan)).toBe('text-mistral-nemo-12b-instruct-q4km');
    expect(plan.warnings.some((w) => w.includes('nominal'))).toBe(false);
  });
});

describe('AC-4 — unified memory is not treated as VRAM', () => {
  test('Apple Silicon 16 GB → usable 8 GB, nativeEngines true', () => {
    const plan = recommend({
      profile: profile({
        platform: 'darwin',
        arch: 'arm64',
        gpu: { vendor: 'apple', unifiedMemory: true },
        ramMb: 16384,
      }),
      modalities: ['text'],
      manifest,
    });
    expect(plan.backend).toBe('metal');
    expect(plan.nativeEngines).toBe(true);
    const text = plan.models.find((m) => m.modality === 'text');
    expect(text).toBeDefined();
    expect(text?.bytes ?? 0).toBeLessThanOrEqual(8 * 1024 * 1024 * 1024);
    expect(plan.warnings.some((w) => w.includes('nominal 8gb'))).toBe(true);
  });
});

describe('AC-5 — modality selection controls the download set', () => {
  test('--modalities text yields exactly one text model', () => {
    const plan = recommend({
      profile: profile({ gpu: { vendor: 'none', unifiedMemory: false }, ramMb: 16384 }),
      modalities: ['text'],
      manifest,
    });
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]?.modality).toBe('text');
    expect(plan.models.some((m) => m.modality === 'image')).toBe(false);
  });

  test('voice + stt pick the any-tier archive entries', () => {
    const plan = recommend({
      profile: profile({ gpu: { vendor: 'none', unifiedMemory: false }, ramMb: 16384 }),
      modalities: ['voice', 'stt'],
      manifest,
    });
    const ids = plan.models.map((m) => m.manifestId).sort();
    expect(ids).toEqual(['stt-moonshine-tiny-en-int8', 'tts-kokoro-82m']);
  });
});
