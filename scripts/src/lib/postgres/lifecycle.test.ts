// scripts/src/lib/postgres/lifecycle.test.ts
// C-387: unit tests for the local PostgreSQL lifecycle config + pure helpers.
// Integration sequences (initdb / pg_ctl) are exercised manually via the CLI
// because they need the Nix-provided binaries.
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearStalePid,
  dataDir,
  isInitialized,
  isProcessAlive,
  logFile,
  POSTGRES_CONNECTION_URL,
  POSTGRES_DATABASE,
  POSTGRES_PORT,
  postmasterPid,
  repoRoot,
  runDir,
} from './lifecycle.ts';

const makeTempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'aikami-pg-test-'));
  return dir;
};

const cleanup = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
};

const writeFileUnder = (root: string, relativePath: string, content: string): void => {
  const file = join(root, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
};

describe('postgres lifecycle config', () => {
  it('uses the allocated Aikami emulator port 5433', () => {
    expect(POSTGRES_PORT).toBe(5433);
  });

  it('builds the documented connection URL', () => {
    expect(POSTGRES_CONNECTION_URL).toBe('postgresql://localhost:5433/aikami_dev?sslmode=disable');
  });

  it('uses the aikami_dev database name from the contract', () => {
    expect(POSTGRES_DATABASE).toBe('aikami_dev');
  });

  it('keeps all state under the repo-local .postgres dir', () => {
    expect(dataDir()).toContain('/.postgres/data');
    expect(runDir()).toContain('/.postgres/run');
    expect(logFile()).toContain('/.postgres/');
  });

  it('resolves the repo root from the script location', () => {
    expect(existsSync(join(repoRoot(), 'flake.nix'))).toBe(true);
    expect(existsSync(join(repoRoot(), 'package.json'))).toBe(true);
  });
});

describe('initialisation state', () => {
  it('reports not initialised for a fresh directory', () => {
    const root = makeTempRoot();
    try {
      expect(isInitialized(root)).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it('reports initialised once PG_VERSION exists', () => {
    const root = makeTempRoot();
    try {
      writeFileUnder(root, '.postgres/data/PG_VERSION', '17\n');
      expect(isInitialized(root)).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe('stale postmaster.pid handling', () => {
  it('reads the pid from postmaster.pid', () => {
    const root = makeTempRoot();
    try {
      writeFileUnder(root, '.postgres/data/postmaster.pid', '4242\n...\n');
      expect(postmasterPid(root)).toBe(4242);
    } finally {
      cleanup(root);
    }
  });

  it('returns undefined when no pid file exists', () => {
    const root = makeTempRoot();
    try {
      expect(postmasterPid(root)).toBeUndefined();
    } finally {
      cleanup(root);
    }
  });

  it('treats the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('treats an impossible pid as dead', () => {
    expect(isProcessAlive(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('clears a stale pid file whose process is gone', () => {
    const root = makeTempRoot();
    try {
      writeFileUnder(root, '.postgres/data/postmaster.pid', '999999\n...\n');
      expect(clearStalePid(root)).toBe(true);
      expect(existsSync(join(dataDir(root), 'postmaster.pid'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it('does not clear a live postmaster pid', () => {
    const root = makeTempRoot();
    try {
      writeFileUnder(root, '.postgres/data/postmaster.pid', `${process.pid}\n...\n`);
      expect(clearStalePid(root)).toBe(false);
      expect(existsSync(join(dataDir(root), 'postmaster.pid'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});
