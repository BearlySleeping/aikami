// scripts/src/lib/agents/contract_pipeline/manifest_store.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  createManifest,
  readManifest,
  releaseLock,
  writeManifest,
} from './manifest_store.ts';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'aikami-manifest-store-'));
  temporaryDirectories.push(path);
  return path;
};

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('pipeline lock', () => {
  it('acquires once and rejects a live owner', async () => {
    const cwd = temporaryDirectory();
    await acquireLock({ contractId: 'C-365', runId: 'run-test-1', cwd });
    await expect(acquireLock({ contractId: 'C-365', runId: 'run-test-2', cwd })).rejects.toThrow(
      'already running',
    );
    releaseLock({ contractId: 'C-365', cwd });
  });

  it('replaces a stale or corrupt lock atomically', async () => {
    const cwd = temporaryDirectory();
    const directory = join(cwd, '.pi/contract-runs');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'lock_C-365.json'),
      '{"pid":999999,"contractId":"C-365","runId":""}',
    );
    await acquireLock({ contractId: 'C-365', runId: 'run-test', cwd });
    releaseLock({ contractId: 'C-365', cwd });
  });
});

describe('manifest store', () => {
  const manifestFor = (cwd: string) => {
    const manifest = createManifest({
      contractId: 'C-365',
      contractPath: join(cwd, 'docs/contracts/C-365-test.md'),
      baseCommit: 'abc123',
      baselineFingerprint: 'baseline',
      startStage: 'write_contract',
    });
    return manifest;
  };

  it('writes and reads a validated manifest', () => {
    const cwd = temporaryDirectory();
    const manifest = manifestFor(cwd);
    writeManifest({ manifest, cwd });
    const stored = readManifest({ runId: manifest.runId, cwd });
    expect(stored?.version).toBe(3);
    expect(stored?.currentStage).toBe('write_contract');
    expect(stored?.baselineFingerprint).toBe('baseline');
  });

  it('rejects missing, corrupt, legacy, and mismatched manifests', () => {
    const cwd = temporaryDirectory();
    expect(readManifest({ runId: 'missing', cwd })).toBeUndefined();

    for (const [runId, content] of [
      ['corrupt', '{'],
      ['legacy', '{"version":2,"runId":"legacy"}'],
      ['mismatch', '{"version":3,"runId":"other"}'],
    ] as const) {
      const directory = join(cwd, '.pi/contract-runs', runId);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'manifest.json'), content);
      expect(readManifest({ runId, cwd })).toBeUndefined();
    }
  });

  it('ignores an interrupted temporary write', () => {
    const cwd = temporaryDirectory();
    const manifest = manifestFor(cwd);
    const directory = join(cwd, '.pi/contract-runs', manifest.runId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'manifest.json.tmp'), 'partial');
    expect(readManifest({ runId: manifest.runId, cwd })).toBeUndefined();
    writeManifest({ manifest, cwd });
    expect(readManifest({ runId: manifest.runId, cwd })?.runId).toBe(manifest.runId);
  });
});
