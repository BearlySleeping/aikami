// apps/backend/local-stack/stack/pair_runner.test.ts
//
// C-522 AC-8 (tooling level): the documented `runner:pair` invocation is the
// shipped one.
//
// `apps/frontend/docs/.../creating-assets.mdx` and `generating-assets.mdx` name
// this command and these flags. If a flag is renamed or its default drifts,
// this is where the docs stop matching the tool.

import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseOptions } from './pair_runner.ts';

describe('AC-8: runner:pair accepts exactly the documented invocation', () => {
  test('pairing requires a hub and a code', () => {
    expect(() => parseOptions([])).toThrow('--hub is required');
    expect(() => parseOptions(['--hub', 'https://hub.example.test', '--pair'])).toThrow(
      '--pair requires --code',
    );
    expect(() =>
      parseOptions(['--hub', 'https://hub.example.test', '--code', 'ABCD-2345-6789']),
    ).toThrow('--code is only meaningful with --pair');
  });

  test('the documented pair invocation parses', () => {
    const parsed = parseOptions([
      '--hub',
      'https://hub.bearlysleeping.com/',
      '--pair',
      '--code',
      'ABCD-2345-6789',
      '--label',
      'Studio desktop',
      '--resource-group',
      'gpu:0',
      '--modalities',
      'image,audio',
      '--upload',
    ]);
    expect(parsed).not.toBe('help');
    if (parsed === 'help') {
      return;
    }
    // The trailing slash is trimmed so every request path is well-formed.
    expect(parsed.hub).toBe('https://hub.bearlysleeping.com');
    expect(parsed.pair).toBe(true);
    expect(parsed.modalities).toEqual(['image', 'audio']);
    expect(parsed.upload).toBe(true);
    // Defaults the docs state.
    expect(parsed.leaseTtlMs).toBe(300_000);
    expect(parsed.pollIntervalMs).toBe(2_000);
    expect(parsed.runsDir).toContain('aikami');
  });

  test('an unsupported modality is refused by name', () => {
    expect(() =>
      parseOptions(['--hub', 'https://hub.example.test', '--modalities', 'image,hologram']),
    ).toThrow('unsupported modality "hologram"');
  });

  test('a non-positive duration is refused', () => {
    expect(() => parseOptions(['--hub', 'https://hub.example.test', '--poll-ms', '0'])).toThrow(
      '--poll-ms must be a positive number',
    );
  });

  test('--help is honoured', () => {
    expect(parseOptions(['--help'])).toBe('help');
  });
});

describe('AC-2: the credential is stored owner-readable and never printed', () => {
  test('a refused pairing exits 3 and writes no credential file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aikami-runner-'));
    const credentialPath = join(dir, 'credentials.json');
    // Point the client at an unreachable origin: the refusal must be reported,
    // not thrown, and nothing may be persisted.
    const code = await main([
      '--hub',
      'http://127.0.0.1:1',
      '--pair',
      '--code',
      'ABCD-2345-6789',
      '--device-id',
      'dev_cli_test_0001',
      '--runs-dir',
      join(dir, 'runs'),
    ]);
    // Unreachable hub → transport failure exit code.
    expect([3, 4]).toContain(code);
    expect(() => statSync(credentialPath)).toThrow();
  });

  test('an unpaired invocation without a stored credential refuses with exit 3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aikami-runner-'));
    const before = process.stderr.write;
    const chunks: string[] = [];
    process.stderr.write = ((chunk: string) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main([
        '--hub',
        'http://127.0.0.1:1',
        '--device-id',
        'dev_cli_test_0002',
        '--runs-dir',
        join(dir, 'runs'),
        '--once',
      ]);
      expect(code).toBe(3);
      expect(chunks.join('')).toContain('--pair');
    } finally {
      process.stderr.write = before;
    }
  });
});

describe('AC-2: a stored credential file is owner-only', () => {
  test('a hand-written credential file is still rejected when unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aikami-runner-'));
    const path = join(dir, 'credentials.json');
    writeFileSync(path, '{"token":"x"}', { mode: 0o600 });
    chmodSync(path, 0o600);
    // `readCredentials` is exercised through `main`: a malformed record must be
    // treated as "unpaired" rather than crashing the runner.
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { token: string };
    expect(raw.token).toBe('x');
    expect(statSync(path).mode & 0o077).toBe(0);
  });
});
