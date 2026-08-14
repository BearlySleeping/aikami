/**
 * apps/backend/local-stack/stack/repo_structure.test.ts
 *
 * C-390 AC-10: the removed artifacts are gone and nothing references them.
 * Also guards the manifest and compose topology invariants so a bad merge
 * cannot silently reintroduce the pre-contract state.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

describe('AC-10 — removed artifacts are absent', () => {
  const forbidden = [
    'Dockerfile.ultimate',
    'docker-compose.lite.yml',
    'docker/scripts/entrypoint-ultimate.sh',
    'docker/client-server/client_server.ts',
    'docker/client-server/package.json',
  ];

  for (const rel of forbidden) {
    it(`is absent: ${rel}`, () => {
      expect(existsSync(join(ROOT, rel))).toBe(false);
    });
  }

  it('no moon.yml or package.json task references the removed artifacts', async () => {
    const moon = await readFile(join(ROOT, 'moon.yml'), 'utf8');
    const pkg = await readFile(join(ROOT, 'package.json'), 'utf8');
    for (const needle of ['ultimate', 'lite', 'client-server', 'client_server']) {
      expect(moon.toLowerCase()).not.toContain(needle);
      expect(pkg.toLowerCase()).not.toContain(needle);
    }
  });
});

describe('compose topology invariants', () => {
  it('compose.yaml exists and carries no `version:` legacy key', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    expect(compose).toContain('services:');
    expect(compose).not.toMatch(/^version:\s*["']?3\./m);
  });

  it('every backend override file exists', () => {
    for (const name of ['cpu', 'cuda', 'rocm', 'vulkan', 'intel', 'musa']) {
      expect(existsSync(join(ROOT, `compose.${name}.yaml`))).toBe(true);
    }
  });

  it('every upstream image reference in the base file is digest-pinned', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    // Owned images use an env-prefixed name (no digest yet — built/published
    // by CI); upstream pulls must carry @sha256:.
    const upstreamLines = compose
      .split('\n')
      .filter((line) => /image:\s*(ghcr\.io|ollama|yanwk)/.test(line));
    expect(upstreamLines.length).toBeGreaterThan(0);
    for (const line of upstreamLines) {
      expect(line).toMatch(/@sha256:[a-f0-9]{64}/);
    }
  });

  it('no image reference is pinned to :latest', async () => {
    const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
    expect(compose).not.toMatch(/image:\s*[^\s]+:latest\b/);
  });
});

describe('model manifest integrity', () => {
  it('models.manifest.json parses with verified entries', async () => {
    const manifest = JSON.parse(
      await readFile(join(ROOT, 'stack/models.manifest.json'), 'utf8'),
    ) as {
      schemaVersion: number;
      entries: Array<{
        id: string;
        modality: string;
        license: string;
        requiresAcknowledgement: boolean;
        kind: string;
        targetPath: string;
        bytes: number;
        sha256: string;
      }>;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries.length).toBeGreaterThanOrEqual(7);
    for (const entry of manifest.entries) {
      expect(entry.id).toBeTruthy();
      expect(entry.targetPath).toBeTruthy();
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    // The acknowledgement-gated entry exists (SD 1.5, OpenRAIL-M).
    const ack = manifest.entries.find((e) => e.requiresAcknowledgement);
    expect(ack).toBeDefined();
    expect(ack?.license).toContain('OpenRAIL');
  });
});
