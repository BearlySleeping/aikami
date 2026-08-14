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
      sha256: 'abc',
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
