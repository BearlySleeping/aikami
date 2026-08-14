// packages/shared/schemas/src/lib/local_ai/model_manifest.test.ts
//
// Schema validation tests for C-391's manifest entry schema: source
// requirements (file needs url or full repo coordinates; archive needs
// url), byte-count integrity (non-negative integer), and sha256 format
// (exactly 64 hex characters).

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { ModelManifestSchema } from './model_manifest.ts';

const VALID_FILE_ENTRY = {
  id: 'text-qwen',
  modality: 'text',
  tier: 'cpu',
  license: 'Apache-2.0',
  requiresAcknowledgement: false,
  kind: 'file',
  repo: 'owner/repo',
  revision: 'rev',
  file: 'model.gguf',
  targetPath: 'text/model.gguf',
  bytes: 100,
  sha256: 'a'.repeat(64),
};

const check = (entry: unknown): boolean =>
  Value.Check(ModelManifestSchema, { schemaVersion: 1, entries: [entry] });

describe('ModelManifestEntrySchema — source requirements', () => {
  test('accepts a file entry with full repo coordinates', () => {
    expect(check(VALID_FILE_ENTRY)).toBe(true);
  });

  test('accepts a file entry with a direct url', () => {
    expect(check({ ...VALID_FILE_ENTRY, url: 'https://example.com/model.gguf' })).toBe(true);
  });

  test('accepts an archive entry with a url', () => {
    expect(
      check({
        id: 'voice-kokoro',
        modality: 'tts',
        tier: 'any',
        license: 'Apache-2.0',
        requiresAcknowledgement: false,
        kind: 'archive',
        url: 'https://example.com/kokoro.tar.bz2',
        targetPath: 'tts/kokoro',
        bytes: 100,
        sha256: 'a'.repeat(64),
      }),
    ).toBe(true);
  });

  test('rejects a file entry with no url and no repo coordinates', () => {
    expect(
      check({ ...VALID_FILE_ENTRY, repo: undefined, revision: undefined, file: undefined }),
    ).toBe(false);
  });

  test('rejects a file entry with only partial repo coordinates', () => {
    expect(check({ ...VALID_FILE_ENTRY, revision: undefined })).toBe(false);
  });

  test('rejects an archive entry without a url', () => {
    expect(
      check({
        id: 'voice-kokoro',
        modality: 'tts',
        tier: 'any',
        license: 'Apache-2.0',
        requiresAcknowledgement: false,
        kind: 'archive',
        targetPath: 'tts/kokoro',
        bytes: 100,
        sha256: 'a'.repeat(64),
      }),
    ).toBe(false);
  });
});

describe('ModelManifestEntrySchema — byte-count integrity', () => {
  test('rejects negative bytes', () => {
    expect(check({ ...VALID_FILE_ENTRY, bytes: -1 })).toBe(false);
  });

  test('rejects a non-integer byte count', () => {
    expect(check({ ...VALID_FILE_ENTRY, bytes: 1.5 })).toBe(false);
  });

  test('accepts zero bytes', () => {
    expect(check({ ...VALID_FILE_ENTRY, bytes: 0 })).toBe(true);
  });
});

describe('ModelManifestEntrySchema — sha256 integrity', () => {
  test('accepts exactly 64 lowercase hex characters', () => {
    expect(check({ ...VALID_FILE_ENTRY, sha256: 'a'.repeat(64) })).toBe(true);
  });

  test('accepts exactly 64 uppercase hex characters', () => {
    expect(check({ ...VALID_FILE_ENTRY, sha256: 'A'.repeat(64) })).toBe(true);
  });

  test('rejects a sha256 that is not 64 characters', () => {
    expect(check({ ...VALID_FILE_ENTRY, sha256: 'a'.repeat(63) })).toBe(false);
  });

  test('rejects a sha256 with non-hex characters', () => {
    expect(check({ ...VALID_FILE_ENTRY, sha256: `${'a'.repeat(63)}z` })).toBe(false);
  });
});
