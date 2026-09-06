// packages/shared/local-ai/src/lib/artifact_resolver.test.ts
import { describe, expect, test } from 'bun:test';
import type { ModelManifestEntry } from '@aikami/types';
import {
  resolveArtifact,
  resolveBundleAssetUrl,
  resolveCompanionArtifacts,
} from './artifact_resolver.ts';

const FILE_ENTRY_WITH_REPO: ModelManifestEntry = {
  id: 'text-qwen2.5-1.5b-instruct-q4km',
  modality: 'text',
  tier: 'cpu',
  license: 'Apache-2.0',
  requiresAcknowledgement: false,
  kind: 'file',
  repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
  revision: '9eadc66189c7641e1ddd226b8267a9119b2ce2d4',
  file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  targetPath: 'text/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  bytes: 986048768,
  sha256: '1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370',
};

const FILE_ENTRY_WITH_URL: ModelManifestEntry = {
  id: 'stt-silero-vad',
  modality: 'stt',
  tier: 'any',
  license: 'MIT',
  requiresAcknowledgement: false,
  kind: 'file',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
  targetPath: 'stt/silero_vad.onnx',
  bytes: 643854,
  sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
};

const ARCHIVE_ENTRY: ModelManifestEntry = {
  id: 'tts-kokoro-82m',
  modality: 'tts',
  tier: 'any',
  license: 'Apache-2.0',
  requiresAcknowledgement: false,
  kind: 'archive',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
  targetPath: 'tts/kokoro-multi-lang-v1_0',
  bytes: 349418188,
  sha256: 'c133d26353d776da730870dac7da07dbfc9a5e3bc80cc5e8e83ab6e823be7046',
};

describe('resolveArtifact', () => {
  test('resolves a file entry with HuggingFace repo coordinates', () => {
    const result = resolveArtifact({ entry: FILE_ENTRY_WITH_REPO });
    expect(result.url).toBe(
      'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/9eadc66189c7641e1ddd226b8267a9119b2ce2d4/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    );
    expect(result.sha256).toBe(FILE_ENTRY_WITH_REPO.sha256);
    expect(result.bytes).toBe(FILE_ENTRY_WITH_REPO.bytes);
    expect(result.targetPath).toBe(FILE_ENTRY_WITH_REPO.targetPath);
    expect(result.id).toBe(FILE_ENTRY_WITH_REPO.id);
    expect(result.kind).toBe('file');
    expect(result.revision).toBe(FILE_ENTRY_WITH_REPO.revision);
  });

  test('resolves a file entry with a direct URL', () => {
    const result = resolveArtifact({ entry: FILE_ENTRY_WITH_URL });
    expect(result.url).toBe(FILE_ENTRY_WITH_URL.url);
    expect(result.kind).toBe('file');
  });

  test('resolves an archive entry', () => {
    const result = resolveArtifact({ entry: ARCHIVE_ENTRY });
    expect(result.url).toBe(ARCHIVE_ENTRY.url);
    expect(result.kind).toBe('archive');
  });

  test('uses a custom HF origin when provided', () => {
    const result = resolveArtifact({
      entry: FILE_ENTRY_WITH_REPO,
      hfOrigin: 'https://hf-mirror.example.com',
    });
    expect(result.url).toContain('hf-mirror.example.com');
    expect(result.url).not.toContain('huggingface.co');
  });

  test('throws for an entry with no repo coordinates and no URL', () => {
    const badEntry: ModelManifestEntry = {
      id: 'bad-entry',
      modality: 'text',
      tier: 'cpu',
      license: 'MIT',
      requiresAcknowledgement: false,
      kind: 'file',
      targetPath: 'bad.gguf',
      bytes: 1000,
      sha256: 'a'.repeat(64),
    };
    expect(() => resolveArtifact({ entry: badEntry })).toThrow('Cannot resolve');
  });
});

describe('resolveCompanionArtifacts', () => {
  const primaryWithCompanions: ModelManifestEntry = {
    id: 'image-anima-aesthetic-v1.1',
    modality: 'image',
    tier: '8gb',
    license: 'circlestone-labs-non-commercial-license',
    requiresAcknowledgement: true,
    kind: 'file',
    repo: 'circlestone-labs/Anima',
    revision: 'f7382c4bf9d7ffe4ceea593a0adbb470c56dd79b',
    file: 'split_files/diffusion_models/anima-aesthetic-v1.1.safetensors',
    targetPath: 'image/anima-aesthetic-v1.1.safetensors',
    bytes: 4182230656,
    sha256: '3c1868387a3a1ff504bbb87c33678321965ead381fcf87afbd0264daa600c082',
    companions: [
      { role: 'vae', id: 'image-anima-vae-qwen-image' },
      { role: 'llm', id: 'image-anima-text-encoder-qwen3-0.6b' },
    ],
  };

  const vaeEntry: ModelManifestEntry = {
    id: 'image-anima-vae-qwen-image',
    modality: 'image',
    tier: 'any',
    license: 'circlestone-labs-non-commercial-license',
    requiresAcknowledgement: true,
    kind: 'file',
    repo: 'circlestone-labs/Anima',
    revision: 'f7382c4bf9d7ffe4ceea593a0adbb470c56dd79b',
    file: 'split_files/vae/qwen_image_vae.safetensors',
    targetPath: 'image/qwen_image_vae.safetensors',
    bytes: 253806246,
    sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
  };

  const textEncoderEntry: ModelManifestEntry = {
    id: 'image-anima-text-encoder-qwen3-0.6b',
    modality: 'image',
    tier: 'any',
    license: 'circlestone-labs-non-commercial-license',
    requiresAcknowledgement: true,
    kind: 'file',
    repo: 'circlestone-labs/Anima',
    revision: 'f7382c4bf9d7ffe4ceea593a0adbb470c56dd79b',
    file: 'split_files/text_encoders/qwen_3_06b_base.safetensors',
    targetPath: 'image/qwen_3_06b_base.safetensors',
    bytes: 1192135096,
    sha256: 'cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba',
  };

  test('resolves companion artifacts for a primary entry', () => {
    const companions = resolveCompanionArtifacts({
      entry: primaryWithCompanions,
      allEntries: [primaryWithCompanions, vaeEntry, textEncoderEntry],
    });
    expect(companions).toHaveLength(2);
    expect(companions[0]?.id).toBe('image-anima-vae-qwen-image');
    expect(companions[1]?.id).toBe('image-anima-text-encoder-qwen3-0.6b');
  });

  test('returns empty array when entry has no companions', () => {
    const companions = resolveCompanionArtifacts({
      entry: FILE_ENTRY_WITH_REPO,
      allEntries: [FILE_ENTRY_WITH_REPO],
    });
    expect(companions).toHaveLength(0);
  });

  test('skips companion entries that are not in the manifest', () => {
    const companions = resolveCompanionArtifacts({
      entry: primaryWithCompanions,
      allEntries: [primaryWithCompanions], // missing the companion entries
    });
    expect(companions).toHaveLength(0);
  });
});

describe('resolveBundleAssetUrl', () => {
  test('builds a HuggingFace download URL from bundle coordinates', () => {
    const url = resolveBundleAssetUrl({
      repo: 'onnx-community/Kokoro-82M-ONNX',
      revision: 'f46687f7e41512228ae953af24a11b2640ea0f22',
      file: 'onnx/model_quantized.onnx',
    });
    expect(url).toBe(
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/onnx/model_quantized.onnx',
    );
  });

  test('uses a custom HF origin when provided', () => {
    const url = resolveBundleAssetUrl({
      repo: 'test-org/test-repo',
      revision: 'abc123',
      file: 'model.bin',
      hfOrigin: 'https://hf-mirror.example.com',
    });
    expect(url).toBe('https://hf-mirror.example.com/test-org/test-repo/resolve/abc123/model.bin');
  });
});
