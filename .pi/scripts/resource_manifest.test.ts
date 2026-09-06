// .pi/scripts/resource_manifest.test.ts
//
// C-478 AC-1/4/5: Resource manifest, worktree identity, provenance report.
// Tests run against local fixtures — no network, no external fetches.

import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Fixture helpers ──────────────────────────────────────────────────

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'res-manifest-test-'));
});

const fixturePath = (...parts: string[]) => join(fixtureDir, ...parts);

const touch = (path: string, content = 'test') => {
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    require('node:fs').mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, content);
};

// ── Tests ────────────────────────────────────────────────────────────

describe('resource-manifest (AC-1: exact inputs)', () => {
  test('loadManifest returns undefined when no manifest exists', async () => {
    const { loadManifest } = await import('./resource_manifest.ts');
    const missingPath = fixturePath('no-manifest.json');
    const result = await loadManifest(missingPath);
    expect(result).toBeUndefined();
  });

  test('saveManifest and loadManifest round-trip', async () => {
    const { createManifest, saveManifest, loadManifest } = await import('./resource_manifest.ts');
    const manifest = createManifest();
    manifest.resources['test-resource'] = {
      name: 'test-resource',
      type: 'local-skill',
      description: 'Test resource',
      source: { kind: 'local', relativePath: '.pi/test' },
      installed: {
        contentHash: 'abc123',
        fileCount: 1,
        recordedAt: new Date().toISOString(),
      },
    };

    const testManifestPath = fixturePath('resource-manifest.json');
    await saveManifest(manifest, testManifestPath);

    // Read back via raw file
    const raw = readFileSync(testManifestPath, 'utf-8');
    const loaded = JSON.parse(raw);
    expect(loaded.manifestVersion).toBe(1);
    expect(loaded.resources['test-resource']).toBeDefined();
    expect(loaded.resources['test-resource'].name).toBe('test-resource');
    expect(loaded.resources['test-resource'].source.kind).toBe('local');

    // Load via loadManifest with path
    const loadedAgain = await loadManifest(testManifestPath);
    expect(loadedAgain).toBeDefined();
    expect(loadedAgain?.resources['test-resource']).toBeDefined();
  });

  test('createManifest creates an empty skeleton', async () => {
    const { createManifest } = await import('./resource_manifest.ts');
    const manifest = createManifest();
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.resources).toEqual({});
    expect(typeof manifest.updatedAt).toBe('string');
  });

  test('hashFile produces consistent SHA-256', async () => {
    const { hashFile } = await import('./resource_manifest.ts');
    const testFile = fixturePath('test.txt');
    touch(testFile, 'hello world');
    const hash = await hashFile(testFile);
    // SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  test('hashDirectory returns empty identity for missing directory', async () => {
    const { hashDirectory } = await import('./resource_manifest.ts');
    const missing = fixturePath('does-not-exist');
    const identity = await hashDirectory(missing);
    expect(identity.contentHash).toBe('');
    expect(identity.fileCount).toBe(0);
  });

  test('hashDirectory hashes directory contents deterministically', async () => {
    const { hashDirectory } = await import('./resource_manifest.ts');
    const dir = fixturePath('test-dir');
    touch(join(dir, 'a.txt'), 'aaa');
    touch(join(dir, 'b.txt'), 'bbb');

    const identity = await hashDirectory(dir);
    expect(identity.fileCount).toBe(2);
    expect(identity.contentHash).toBeTruthy();
    expect(identity.contentHash.length).toBe(64); // SHA-256 hex

    // Deterministic — same content produces same hash
    const identity2 = await hashDirectory(dir);
    expect(identity2.contentHash).toBe(identity.contentHash);
  });

  test('parsePackageSpec handles npm: and git: specs', async () => {
    const { parsePackageSpec } = await import('./resource_manifest.ts');
    const npmSpec = parsePackageSpec('npm:context-mode');
    expect(npmSpec?.kind).toBe('npm');
    if (npmSpec?.kind === 'npm') {
      expect(npmSpec.package).toBe('context-mode');
      expect(npmSpec.version).toBe('latest');
    }

    const gitSpec = parsePackageSpec('git:github.com/example/repo.git');
    expect(gitSpec?.kind).toBe('git');
    if (gitSpec?.kind === 'git') {
      expect(gitSpec.url).toBe('github.com/example/repo.git');
    }

    expect(parsePackageSpec('unknown:format')).toBeUndefined();
  });
});

describe('resource-graph identity (AC-4)', () => {
  test('computeResourceGraphIdentity produces a hash', async () => {
    const { computeResourceGraphIdentity, createManifest } = await import('./resource_manifest.ts');

    const manifest = createManifest();
    const settings = {
      packages: ['npm:test-pkg'],
      skills: ['./skills', './generated-skills'],
      extensions: ['./extensions'],
      prompts: ['./prompts'],
    };

    const identity = await computeResourceGraphIdentity(manifest, settings);
    expect(identity.manifestHash).toBeTruthy();
    expect(identity.settingsHash).toBeTruthy();
    expect(identity.combinedHash).toBeTruthy();
    expect(identity.combinedHash.length).toBe(64);
  });

  test('different manifests produce different identities', async () => {
    const { computeResourceGraphIdentity, createManifest } = await import('./resource_manifest.ts');

    const settings = {
      packages: [],
      skills: [],
      extensions: [],
      prompts: [],
    };

    const manifestA = createManifest();
    manifestA.resources.a = {
      name: 'a',
      type: 'local-skill',
      description: 'Resource A',
      source: { kind: 'local', relativePath: '.pi/a' },
      installed: { contentHash: 'hash-a', fileCount: 1, recordedAt: new Date().toISOString() },
    };

    const manifestB = createManifest();
    manifestB.resources.b = {
      name: 'b',
      type: 'local-skill',
      description: 'Resource B',
      source: { kind: 'local', relativePath: '.pi/b' },
      installed: { contentHash: 'hash-b', fileCount: 1, recordedAt: new Date().toISOString() },
    };

    const identityA = await computeResourceGraphIdentity(manifestA, settings);
    const identityB = await computeResourceGraphIdentity(manifestB, settings);
    expect(identityA.combinedHash).not.toBe(identityB.combinedHash);
  });

  test('different settings produce different identities', async () => {
    const { computeResourceGraphIdentity, createManifest } = await import('./resource_manifest.ts');

    const manifest = createManifest();

    const identityA = await computeResourceGraphIdentity(manifest, {
      packages: ['npm:a'],
      skills: [],
      extensions: [],
      prompts: [],
    });

    const identityB = await computeResourceGraphIdentity(manifest, {
      packages: ['npm:b'],
      skills: [],
      extensions: [],
      prompts: [],
    });

    expect(identityA.combinedHash).not.toBe(identityB.combinedHash);
  });

  test('compareGraphIdentities detects differences', async () => {
    const { compareGraphIdentities } = await import('./resource_manifest.ts');

    const base = {
      manifestHash: 'aaa',
      settingsHash: 'bbb',
      generatedContentHash: 'ccc',
      combinedHash: 'ddd',
    };

    expect(compareGraphIdentities(base, base)).toEqual([]);

    const diffManifest = { ...base, manifestHash: 'xxx' };
    expect(compareGraphIdentities(base, diffManifest)).toEqual(['manifest']);

    const diffSettings = { ...base, settingsHash: 'yyy' };
    expect(compareGraphIdentities(base, diffSettings)).toEqual(['settings']);

    const diffGenerated = { ...base, generatedContentHash: 'zzz' };
    expect(compareGraphIdentities(base, diffGenerated)).toEqual(['generated-content']);
  });
});

describe('provenance report (AC-5)', () => {
  test('generateProvenanceReport produces a structured report', async () => {
    const { generateProvenanceReport, createManifest } = await import('./resource_manifest.ts');

    const manifest = createManifest();
    manifest.resources.test = {
      name: 'test',
      type: 'local-skill',
      description: 'Test resource',
      source: { kind: 'local', relativePath: '.pi/test' },
      installed: { contentHash: 'hash', fileCount: 1, recordedAt: new Date().toISOString() },
    };

    const report = await generateProvenanceReport(manifest);
    expect(report.totalResources).toBe(1);
    expect(report.resourceTypes['local-skill']).toBe(1);
    expect(report.entries).toHaveLength(1);
    expect(report.identity.combinedHash).toBeTruthy();
  });

  test('formatProvenanceReport produces readable output', async () => {
    const { generateProvenanceReport, createManifest, formatProvenanceReport } = await import(
      './resource_manifest.ts'
    );

    const manifest = createManifest();
    manifest.resources.test = {
      name: 'test',
      type: 'local-skill',
      description: 'Test resource',
      source: { kind: 'local', relativePath: '.pi/test' },
      installed: { contentHash: 'abc123', fileCount: 1, recordedAt: new Date().toISOString() },
    };

    const report = await generateProvenanceReport(manifest);
    const formatted = formatProvenanceReport(report);
    expect(formatted).toContain('Resource Provenance Report');
    expect(formatted).toContain('Total managed resources: 1');
    expect(formatted).toContain('test (local-skill)');
  });
});
