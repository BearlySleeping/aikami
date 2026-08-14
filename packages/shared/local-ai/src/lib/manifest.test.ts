// packages/shared/local-ai/src/lib/manifest.test.ts
import { describe, expect, test } from 'bun:test';
import { createFixtureExecutor } from './fixture_executor.ts';
import { loadManifest, parseManifest } from './manifest.ts';

const MANIFEST_JSON = JSON.stringify({
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
      file: 'model.gguf',
      targetPath: 'text/qwen.gguf',
      bytes: 986048768,
      sha256: 'a'.repeat(64),
    },
  ],
});

describe('parseManifest', () => {
  test('parses a valid manifest', () => {
    const manifest = parseManifest(MANIFEST_JSON);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.id).toBe('text-qwen2.5-1.5b-instruct-q4km');
  });

  test('rejects invalid JSON', () => {
    expect(() => parseManifest('{not json')).toThrow(/invalid manifest JSON/);
  });

  test('rejects a wrong schema version', () => {
    expect(() => parseManifest('{"schemaVersion":2,"entries":[]}')).toThrow(/does not match/);
  });

  test('rejects an entry missing required fields', () => {
    expect(() =>
      parseManifest(JSON.stringify({ schemaVersion: 1, entries: [{ id: 'x' }] })),
    ).toThrow(/does not match/);
  });

  test('rejects a file entry without a source (no url and no repo coordinates)', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              id: 'text-no-source',
              modality: 'text',
              tier: 'cpu',
              license: 'Apache-2.0',
              requiresAcknowledgement: false,
              kind: 'file',
              targetPath: 'text/m.gguf',
              bytes: 100,
              sha256: 'a'.repeat(64),
            },
          ],
        }),
      ),
    ).toThrow(/does not match/);
  });

  test('rejects a file entry with partial repo coordinates', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              id: 'text-partial-repo',
              modality: 'text',
              tier: 'cpu',
              license: 'Apache-2.0',
              requiresAcknowledgement: false,
              kind: 'file',
              repo: 'owner/repo',
              revision: 'rev',
              targetPath: 'text/m.gguf',
              bytes: 100,
              sha256: 'a'.repeat(64),
            },
          ],
        }),
      ),
    ).toThrow(/does not match/);
  });

  test('rejects an archive entry without a url', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              id: 'voice-no-url',
              modality: 'tts',
              tier: 'any',
              license: 'Apache-2.0',
              requiresAcknowledgement: false,
              kind: 'archive',
              targetPath: 'tts/kokoro',
              bytes: 100,
              sha256: 'a'.repeat(64),
            },
          ],
        }),
      ),
    ).toThrow(/does not match/);
  });

  test('rejects negative bytes', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              id: 'text-negative-bytes',
              modality: 'text',
              tier: 'cpu',
              license: 'Apache-2.0',
              requiresAcknowledgement: false,
              kind: 'file',
              repo: 'owner/repo',
              revision: 'rev',
              file: 'm.gguf',
              targetPath: 'text/m.gguf',
              bytes: -1,
              sha256: 'a'.repeat(64),
            },
          ],
        }),
      ),
    ).toThrow(/does not match/);
  });

  test('rejects a non-integer byte count', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              id: 'text-float-bytes',
              modality: 'text',
              tier: 'cpu',
              license: 'Apache-2.0',
              requiresAcknowledgement: false,
              kind: 'file',
              repo: 'owner/repo',
              revision: 'rev',
              file: 'm.gguf',
              targetPath: 'text/m.gguf',
              bytes: 1.5,
              sha256: 'a'.repeat(64),
            },
          ],
        }),
      ),
    ).toThrow(/does not match/);
  });

  test('rejects a sha256 that is not 64 hex characters', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              id: 'text-bad-sha',
              modality: 'text',
              tier: 'cpu',
              license: 'Apache-2.0',
              requiresAcknowledgement: false,
              kind: 'file',
              repo: 'owner/repo',
              revision: 'rev',
              file: 'm.gguf',
              targetPath: 'text/m.gguf',
              bytes: 100,
              sha256: 'zz-not-hex',
            },
          ],
        }),
      ),
    ).toThrow(/does not match/);
  });

  test('accepts a file entry with a direct url (no repo coordinates)', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          id: 'text-url-only',
          modality: 'text',
          tier: 'cpu',
          license: 'Apache-2.0',
          requiresAcknowledgement: false,
          kind: 'file',
          url: 'https://example.com/model.gguf',
          targetPath: 'text/m.gguf',
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
      ],
    });
    const manifest = parseManifest(raw);
    expect(manifest.entries[0]?.id).toBe('text-url-only');
  });
});

describe('loadManifest', () => {
  test('reads through the executor seam', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [],
        files: [
          {
            path: '/m/manifest.json',
            result: { ok: true, stdout: MANIFEST_JSON, stderr: '', exitCode: 0 },
          },
        ],
        statfs: [],
      },
    });
    const manifest = await loadManifest({ executor, path: '/m/manifest.json' });
    expect(manifest.entries[0]?.id).toBe('text-qwen2.5-1.5b-instruct-q4km');
  });

  test('throws when the read fails', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [],
        files: [{ path: '/m/missing.json', result: { ok: false, reason: 'not-found' } }],
        statfs: [],
      },
    });
    await expect(loadManifest({ executor, path: '/m/missing.json' })).rejects.toThrow(
      /manifest read failed/,
    );
  });
});
