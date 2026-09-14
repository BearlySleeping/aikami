// apps/backend/local-stack/stack/generation/audio_ingest.test.ts
//
// C-521: the two host-side ingest seams — resolving a provider profile's pinned
// model set from the stack manifest, and bounding an imported recording's
// locator. Both are the difference between "the profile is honoured" and "the
// runner silently used the v1 checkpoint / read any path it was handed".
//
// Contract: C-521 Music and SFX generation with audio preparation

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationProviderProfile } from '@aikami/constants';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import type { ModelManifest } from '@aikami/types';
import { resolveAudioImport } from './audio_import.ts';
import { resolveAudioModelSet } from './model_sets.ts';

const scratchDirs: string[] = [];
const makeScratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `c521-${label}-`));
  scratchDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A manifest with one installed audio checkpoint. */
const manifestWith = (entries: ModelManifest['entries']): ModelManifest =>
  ({ schemaVersion: 1, entries }) as ModelManifest;

/**
 * The v1 set as the real manifest declares it: a primary entry plus its
 * companions, each in its own component directory under one root.
 */
const v1Entry = {
  id: 'audio-ace-step-v1-3.5b',
  modality: 'audio',
  tier: 'any',
  license: 'Apache-2.0',
  requiresAcknowledgement: false,
  kind: 'file',
  repo: 'ACE-Step/ACE-Step-v1-3.5B',
  revision: '82cd0d7b6322bd28cd4e830fe675ddb6180ce36c',
  file: 'ace_step_transformer/diffusion_pytorch_model.safetensors',
  targetPath: 'audio/ace-step-v1-3.5b/ace_step_transformer/diffusion_pytorch_model.safetensors',
  bytes: 1,
  sha256: 'a'.repeat(64),
  companions: [
    { role: 'audio_vae', id: 'audio-ace-step-music-dcae' },
    { role: 'vocoder', id: 'audio-ace-step-music-vocoder' },
    { role: 'text_encoder', id: 'audio-ace-step-umt5-base' },
  ],
} as ModelManifest['entries'][number];

const v1Companions = [
  'audio-ace-step-music-dcae',
  'audio-ace-step-music-vocoder',
  'audio-ace-step-umt5-base',
].map((id) => {
  const component = {
    'audio-ace-step-music-dcae': 'music_dcae_f8c8/diffusion_pytorch_model.safetensors',
    'audio-ace-step-music-vocoder': 'music_vocoder/diffusion_pytorch_model.safetensors',
    'audio-ace-step-umt5-base': 'umt5-base/model.safetensors',
  }[id] as string;
  return {
    ...v1Entry,
    id,
    file: component,
    targetPath: `audio/ace-step-v1-3.5b/${component}`,
    companions: undefined,
  } as unknown as ModelManifest['entries'][number];
});

const v1Set = [v1Entry, ...v1Companions];

describe('resolveAudioModelSet', () => {
  test('derives the container checkpoint path from the profile model id', () => {
    const resolution = resolveAudioModelSet({
      profile: GENERATION_PROVIDER_PROFILES.ace_step_v1_3_5b_profile,
      manifest: manifestWith(v1Set),
    });
    expect(resolution.installed).toBe(true);
    if (!resolution.installed) {
      throw new Error('expected an installed model set');
    }
    // The manifest's targetPath directory, under the container mount — NOT a
    // hardcoded v1 path.
    expect(resolution.checkpointPath).toBe('/models/audio/ace-step-v1-3.5b');
    expect(resolution.modelId).toBe('audio-ace-step-v1-3.5b');
  });

  test('the declared default music profile has no pinned set, so it is not installed', () => {
    const resolution = resolveAudioModelSet({
      profile: GENERATION_PROVIDER_PROFILES.ace_step_15_2b_turbo_profile,
      manifest: manifestWith(v1Set),
    });
    expect(resolution.installed).toBe(false);
    if (resolution.installed) {
      throw new Error('expected the v1.5 set to be missing');
    }
    // 🔴 The refusal has to say it will not substitute the v1 checkpoint.
    expect(resolution.reason).toContain('not pinned');
    expect(resolution.reason).toContain('will not fall back to a different checkpoint');
    expect(resolution.reason).toContain('audio-ace-step-v15-2b-turbo');
  });

  test('a profile with no model id cannot be resolved', () => {
    const profile: GenerationProviderProfile = {
      id: 'anonymous_audio',
      label: 'No pinned model',
      mode: 'local',
      modality: 'audio',
      engineId: 'ace-step',
      estimatedSpendUsdPerCandidate: 0,
      requiresRightsDecision: false,
      note: 'fixture',
    };
    const resolution = resolveAudioModelSet({ profile, manifest: manifestWith(v1Set) });
    expect(resolution.installed).toBe(false);
    if (resolution.installed) {
      throw new Error('expected a refusal');
    }
    expect(resolution.reason).toContain('declares no modelId');
  });

  test('the container root is overridable for a non-default mount', () => {
    const resolution = resolveAudioModelSet({
      profile: GENERATION_PROVIDER_PROFILES.ace_step_v1_3_5b_profile,
      manifest: manifestWith(v1Set),
      containerRoot: '/opt/models',
    });
    expect(resolution.installed && resolution.checkpointPath).toBe(
      '/opt/models/audio/ace-step-v1-3.5b',
    );
  });

  test('stops the shared directory at the first mismatched segment', () => {
    const splitSet = v1Set.map((entry, index) => ({
      ...entry,
      targetPath: `audio/split-root/${index === 0 ? 'primary' : 'companion'}/shared/model.bin`,
    }));

    const resolution = resolveAudioModelSet({
      profile: GENERATION_PROVIDER_PROFILES.ace_step_v1_3_5b_profile,
      manifest: manifestWith(splitSet),
    });

    expect(resolution.installed && resolution.checkpointPath).toBe('/models/audio/split-root');
  });
});

describe('resolveAudioImport', () => {
  const audioBytes = new Uint8Array([1, 2, 3, 4]);

  test('resolves a recording inside the import root', () => {
    const root = makeScratch('root');
    mkdirSync(join(root, 'village'), { recursive: true });
    writeFileSync(join(root, 'village', 'gate.wav'), audioBytes);
    const resolved = resolveAudioImport({ locator: 'village/gate.wav', importRoot: root });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    expect(resolved.extension).toBe('.wav');
    expect(resolved.bytes).toBe(audioBytes.length);
  });

  test('refuses traversal, a foreign absolute path and a URL', () => {
    const root = makeScratch('root-escape');
    for (const locator of ['../outside.wav', '/etc/passwd.wav', 'https://example.com/a.wav']) {
      const resolved = resolveAudioImport({ locator, importRoot: root });
      expect(resolved.ok, locator).toBe(false);
      if (resolved.ok) {
        throw new Error('expected a refusal');
      }
      expect(resolved.code).toBe('import_locator_rejected');
    }
  });

  test('refuses a symlink whose real path escapes the import root', () => {
    const root = makeScratch('root-symlink');
    const outside = makeScratch('outside-symlink');
    writeFileSync(join(outside, 'escape.wav'), audioBytes);
    symlinkSync(join(outside, 'escape.wav'), join(root, 'escape.wav'));

    const resolved = resolveAudioImport({ locator: 'escape.wav', importRoot: root });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error('expected a refusal');
    }
    expect(resolved.code).toBe('import_locator_rejected');
  });

  test('refuses an extension the installed catalog cannot install', () => {
    const root = makeScratch('root-ext');
    writeFileSync(join(root, 'recording.opus'), audioBytes);
    const resolved = resolveAudioImport({ locator: 'recording.opus', importRoot: root });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error('expected a refusal');
    }
    expect(resolved.code).toBe('import_format_unsupported');
    // The refusal names the authoritative constant rather than an opinion.
    expect(resolved.message).toContain('.webm');
  });

  test('refuses a missing file, an empty file and an oversized file', () => {
    const root = makeScratch('root-bounds');
    writeFileSync(join(root, 'empty.wav'), new Uint8Array(0));
    writeFileSync(join(root, 'big.wav'), new Uint8Array(64));

    const missing = resolveAudioImport({ locator: 'nope.wav', importRoot: root });
    expect(missing.ok === false && missing.code).toBe('import_source_missing');

    const empty = resolveAudioImport({ locator: 'empty.wav', importRoot: root });
    expect(empty.ok === false && empty.code).toBe('import_source_empty');

    const oversized = resolveAudioImport({
      locator: 'big.wav',
      importRoot: root,
      maxBytes: 8,
    });
    expect(oversized.ok === false && oversized.code).toBe('import_source_too_large');
  });

  test('an empty locator is refused rather than resolving to the root', () => {
    const root = makeScratch('root-empty-locator');
    const resolved = resolveAudioImport({ locator: '   ', importRoot: root });
    expect(resolved.ok === false && resolved.code).toBe('import_locator_empty');
  });
});
