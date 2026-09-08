// scripts/src/lib/release/__tests__/version.test.ts

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  bumpSemver,
  CARGO_TOML,
  compareSemverDesc,
  formatSemver,
  parseSemver,
  readCommittedVersion,
  resolveNextVersion,
  resolveReleaseVersion,
  TAURI_CONF,
  writeCommittedVersion,
} from '../version.ts';

/** A throwaway repo root with the two version files in place. */
const fixture = (options: { cargoVersion: string; confVersion: string }): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-version-'));
  const cargoPath = join(root, CARGO_TOML);
  const confPath = join(root, TAURI_CONF);
  mkdirSync(dirname(cargoPath), { recursive: true });
  writeFileSync(
    cargoPath,
    [
      '[package]',
      'name = "aikami"',
      `version = "${options.cargoVersion}"`,
      'edition = "2021"',
      '',
      '[dependencies]',
      'serde = { version = "1.0.999" }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    confPath,
    `${JSON.stringify({ productName: 'Aikami', version: options.confVersion }, null, 2)}\n`,
  );
  return root;
};

describe('parseSemver', () => {
  test('accepts a bare and a v-prefixed version', () => {
    expect(parseSemver('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 });
    expect(parseSemver('v1.20.3')).toEqual({ major: 1, minor: 20, patch: 3 });
  });

  test('rejects the rolling staging tag and other non-versions', () => {
    expect(parseSemver('staging')).toBeNull();
    expect(parseSemver('v0.2')).toBeNull();
    expect(parseSemver('v0.2.0-rc.1')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('bumpSemver', () => {
  test('minor and major reset the lower components', () => {
    expect(formatSemver(bumpSemver({ major: 1, minor: 4, patch: 7 }, 'patch'))).toBe('1.4.8');
    expect(formatSemver(bumpSemver({ major: 1, minor: 4, patch: 7 }, 'minor'))).toBe('1.5.0');
    expect(formatSemver(bumpSemver({ major: 1, minor: 4, patch: 7 }, 'major'))).toBe('2.0.0');
  });
});

describe('compareSemverDesc', () => {
  test('sorts numerically, not lexically', () => {
    // The real tag history (v0.0.11, v0.0.101, v0.0.195, v0.1.1) is exactly
    // where a lexical sort picks the wrong "latest".
    const sorted = ['v0.0.11', 'v0.1.1', 'v0.0.195', 'v0.0.101']
      .map((t) => parseSemver(t))
      .filter((v) => v !== null)
      .sort(compareSemverDesc)
      .map(formatSemver);
    expect(sorted).toEqual(['0.1.1', '0.0.195', '0.0.101', '0.0.11']);
  });
});

describe('resolveNextVersion', () => {
  const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });

  test('claims the next patch when the committed version is the last release', () => {
    const next = resolveNextVersion({ committed: v(0, 1, 1), lastStable: v(0, 1, 1), bump: null });
    expect(formatSemver(next)).toBe('0.1.2');
  });

  test('a second staging cut advances beyond the installed rolling version', () => {
    const next = resolveNextVersion({ committed: v(0, 2, 0), lastStable: v(0, 1, 1), bump: null });
    expect(formatSemver(next)).toBe('0.2.1');
  });

  test('an explicit bump on a claimed version starts a new one', () => {
    const next = resolveNextVersion({
      committed: v(0, 2, 0),
      lastStable: v(0, 1, 1),
      bump: 'minor',
    });
    expect(formatSemver(next)).toBe('0.3.0');
  });

  test('an explicit bump on an unclaimed version bumps the last release', () => {
    const next = resolveNextVersion({
      committed: v(0, 1, 1),
      lastStable: v(0, 1, 1),
      bump: 'major',
    });
    expect(formatSemver(next)).toBe('1.0.0');
  });

  test('with no stable tag yet, the next cut advances from the committed version', () => {
    const next = resolveNextVersion({ committed: v(0, 1, 0), lastStable: null, bump: null });
    expect(formatSemver(next)).toBe('0.1.1');
  });
});

describe('readCommittedVersion', () => {
  test('reads the [package] version, not the first dependency pin', () => {
    const root = fixture({ cargoVersion: '0.3.1', confVersion: '0.3.1' });
    try {
      expect(readCommittedVersion(root)).toBe('0.3.1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('writeCommittedVersion', () => {
  test('rewrites both files and reports what changed', () => {
    const root = fixture({ cargoVersion: '0.1.0', confVersion: '0.1.0' });
    try {
      const changed = writeCommittedVersion(root, '0.2.0');
      expect(changed).toEqual([CARGO_TOML, TAURI_CONF]);
      expect(readCommittedVersion(root)).toBe('0.2.0');
      expect(JSON.parse(readFileSync(join(root, TAURI_CONF), 'utf8')).version).toBe('0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('leaves the dependency pin untouched', () => {
    const root = fixture({ cargoVersion: '0.1.0', confVersion: '0.1.0' });
    try {
      writeCommittedVersion(root, '0.2.0');
      expect(readFileSync(join(root, CARGO_TOML), 'utf8')).toContain(
        'serde = { version = "1.0.999" }',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('is a no-op when both files already hold the version', () => {
    const root = fixture({ cargoVersion: '0.2.0', confVersion: '0.2.0' });
    try {
      expect(writeCommittedVersion(root, '0.2.0')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('only rewrites the top-level version, never a nested one that appears first', () => {
    const root = fixture({ cargoVersion: '0.1.0', confVersion: '0.1.0' });
    try {
      const confPath = join(root, TAURI_CONF);
      writeFileSync(
        confPath,
        `${JSON.stringify(
          { plugins: { updater: { version: '9.9.9' } }, version: '0.1.0' },
          null,
          2,
        )}\n`,
      );
      writeCommittedVersion(root, '0.2.0');
      const rewritten = JSON.parse(readFileSync(confPath, 'utf8'));
      expect(rewritten.version).toBe('0.2.0');
      expect(rewritten.plugins.updater.version).toBe('9.9.9');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolveReleaseVersion', () => {
  test('a semver tag wins over the committed version', () => {
    const root = fixture({ cargoVersion: '0.1.0', confVersion: '0.1.0' });
    try {
      expect(resolveReleaseVersion('v0.9.4', root)).toBe('0.9.4');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the rolling staging tag falls back to the committed version', () => {
    const root = fixture({ cargoVersion: '0.2.0', confVersion: '0.2.0' });
    try {
      // Never "staging" — that string would land in latest.json's `version`
      // and in the bundle, and no client could compare against it.
      expect(resolveReleaseVersion('staging', root)).toBe('0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('no tag (workflow_dispatch / local build) uses the committed version', () => {
    const root = fixture({ cargoVersion: '0.2.0', confVersion: '0.2.0' });
    try {
      expect(resolveReleaseVersion(null, root)).toBe('0.2.0');
      expect(resolveReleaseVersion(undefined, root)).toBe('0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
