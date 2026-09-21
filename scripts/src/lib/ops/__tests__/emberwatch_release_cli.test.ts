// scripts/src/lib/ops/__tests__/emberwatch_release_cli.test.ts
//
// CLI-PATH tests. These spawn the real `emberwatch:release` entry point and
// assert its exit code and its output — not a helper's return value.
//
// The bug these pin: `--plan` decided success from the coverage audit alone.
// Candidate verification and plan construction were "best-effort" and their
// failures were printed as warnings, so a run whose candidate did not verify —
// or whose plan could not be built — still exited 0 whenever the audit passed.
// A plan reporting success for a release that cannot happen.
//
// The release plane is redirected to a temp directory so the tests neither read
// nor disturb a developer's sealed candidate. That seam cannot weaken a gate:
// the staging approval still resolves against the real staging origin.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_ORIGINS } from '@aikami/constants';
import { SCRIPTS_ENV_ROOT_ENV } from '../../env/scripts_env.ts';
import { buildCandidateLock } from '../emberwatch_candidate.ts';
import { RELEASE_PLANE_ENV } from '../emberwatch_release_io.ts';

const REPOSITORY = join(import.meta.dir, '../../../../..');
const CLI = 'scripts/src/lib/ops/emberwatch_release.ts';

type CliRun = { status: number | null; output: string };

let plane: string;
let envRoot: string;

beforeEach(() => {
  plane = mkdtempSync(join(tmpdir(), 'aikami-cli-plane-'));
  envRoot = mkdtempSync(join(tmpdir(), 'aikami-cli-env-'));
});

afterEach(() => {
  rmSync(plane, { recursive: true, force: true });
  rmSync(envRoot, { recursive: true, force: true });
});

/**
 * Writes the mode's canonical identity beneath the isolated env root.
 *
 * A decrypted checkout has it; CI does not. Without it the release-target gate
 * refuses before the phase under test, which would make these tests pass for
 * the wrong reason.
 */
const ensureModeEnv = (mode: 'staging' | 'production'): void => {
  const path = join(envRoot, 'scripts', `.env.${mode}`);
  const identity = CATALOG_ORIGINS[mode];
  mkdirSync(join(envRoot, 'scripts'), { recursive: true });
  writeFileSync(
    path,
    [
      `CATALOG_BUCKET=${identity.bucketName}`,
      `CATALOG_ORIGIN_URL=${identity.originUrl ?? ''}`,
      '',
    ].join('\n'),
  );
};

/** Writes a sealed candidate that re-derives from the CURRENT source tree. */
const sealCurrentTree = (): string => {
  const { lock } = buildCandidateLock();
  writeFileSync(join(plane, 'candidate.latest.json'), `${JSON.stringify(lock, null, 2)}\n`);
  return lock.lockHash;
};

const runCli = (args: string[]): CliRun => {
  const env = { ...process.env };
  delete env.CATALOG_BUCKET;
  delete env.CATALOG_ORIGIN_URL;
  delete env.AIKAMI_CATALOG_TEST_SEAM;
  env[SCRIPTS_ENV_ROOT_ENV] = envRoot;
  env[RELEASE_PLANE_ENV] = plane;
  const result = spawnSync('bun', [CLI, ...args], {
    cwd: REPOSITORY,
    encoding: 'utf8',
    timeout: 180_000,
    env,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

/** The release report the run wrote, if it wrote one. */
const writtenReport = (mode: string): Record<string, unknown> | undefined => {
  const dir = join(plane, mode);
  if (!existsSync(dir)) {
    return undefined;
  }
  const report = readdirSync(dir).sort().pop();
  return report === undefined
    ? undefined
    : (JSON.parse(readFileSync(join(dir, report), 'utf8')) as Record<string, unknown>);
};

describe('emberwatch:release --plan — usage', () => {
  test('an unknown mode exits 4 without touching a target', () => {
    const run = runCli(['--mode', 'bogus', '--plan']);
    expect(run.status).toBe(4);
    expect(run.output).toContain('--mode must be staging or production');
  });

  test('no arguments prints usage and exits 4', () => {
    const run = runCli([]);
    expect(run.status).toBe(4);
    expect(run.output).toContain('Emberwatch release orchestrator');
  });
});

describe('emberwatch:legacy-bootstrap — production-only mode gate', () => {
  test('staging exits as invalid before target resolution', () => {
    const result = spawnSync(
      'bun',
      ['scripts/src/lib/ops/legacy_catalog_bootstrap.ts', '--mode', 'staging'],
      {
        cwd: REPOSITORY,
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, [SCRIPTS_ENV_ROOT_ENV]: envRoot },
      },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.status).toBe(4);
    expect(output).toContain('--mode must be production');
    expect(output).not.toContain('release target refused');
  });
});

describe('emberwatch:release --plan — a failed plan is not a success', () => {
  test('a missing sealed candidate makes --plan exit non-zero', () => {
    ensureModeEnv('staging');
    const run = runCli(['--mode', 'staging', '--plan']);

    expect(run.status).toBe(2);
    expect(run.output).toContain('plan FAILED');
    expect(run.output).toContain('verify sealed candidate');
    expect(run.output).toContain('no sealed candidate');
    expect(run.output).toContain('No remote write was performed');
  });

  test('a candidate that no longer re-derives from the tree makes --plan exit non-zero', () => {
    ensureModeEnv('staging');
    // A schema-valid lock whose content does not match this checkout.
    const { lock } = buildCandidateLock();
    const tampered = { ...lock, packVersion: '0.0.1-not-this-tree' };
    writeFileSync(join(plane, 'candidate.latest.json'), JSON.stringify(tampered));

    const run = runCli(['--mode', 'staging', '--plan']);

    expect(run.status).toBe(2);
    expect(run.output).toContain('plan FAILED');
    expect(run.output).toContain('verify sealed candidate');
  });

  test('the release report records every mandatory phase and its outcome', () => {
    ensureModeEnv('staging');
    sealCurrentTree();
    runCli(['--mode', 'staging', '--plan']);

    const report = writtenReport('staging');
    expect(report).toBeDefined();
    const steps = (report?.steps ?? []) as { name: string; status: string }[];
    const byName = new Map(steps.map((step) => [step.name, step.status]));

    expect(byName.get('coverage audit (read-only)')).toBeDefined();
    expect(byName.get('verify sealed candidate')).toBe('ok');
  });
});

describe('emberwatch:release --plan — production requires a staging approval', () => {
  test('a missing staging receipt blocks the production plan', () => {
    ensureModeEnv('production');
    sealCurrentTree();

    const run = runCli(['--mode', 'production', '--plan']);

    expect(run.status).toBe(2);
    expect(run.output).toContain('plan FAILED');
    expect(run.output).toContain('staging approval');
    expect(run.output).toContain('receipt-absent');
  });

  test('a malformed staging receipt blocks the production plan', () => {
    ensureModeEnv('production');
    sealCurrentTree();
    writeFileSync(join(plane, 'receipt-staging.json'), '{not json');

    const run = runCli(['--mode', 'production', '--plan']);

    expect(run.status).toBe(2);
    expect(run.output).toContain('receipt-malformed');
  });

  test('a receipt for a DIFFERENT candidate blocks the production plan', () => {
    ensureModeEnv('production');
    sealCurrentTree();
    writeFileSync(
      join(plane, 'receipt-staging.json'),
      JSON.stringify({
        schemaVersion: 'release.receipt.v1',
        candidateLockHash: 'f'.repeat(64),
        planHash: 'b'.repeat(64),
        mode: 'staging',
        bucket: CATALOG_ORIGINS.staging.bucketName,
        originUrl: CATALOG_ORIGINS.staging.originUrl,
        previousReleaseId: '',
        releaseId: 'some-release',
        catalogRootHash: 'c'.repeat(64),
        catalogShards: {},
        dependencies: [],
        packLockHash: '',
        activated: true,
        alreadyActive: false,
        legacyAliasWritten: true,
        legacyAliasError: '',
        verified: true,
        verificationError: '',
        phases: [],
        startedAt: '2026-09-20T00:00:00.000Z',
        finishedAt: '2026-09-20T00:01:00.000Z',
      }),
    );

    const run = runCli(['--mode', 'production', '--plan']);

    expect(run.status).toBe(2);
    expect(run.output).toContain('receipt-candidate-mismatch');
  });

  test('staging does NOT require a staging approval', () => {
    // The gate is production-only. A staging plan must not be blocked by the
    // absence of a receipt for the release it is about to create.
    ensureModeEnv('staging');
    sealCurrentTree();

    const run = runCli(['--mode', 'staging', '--plan']);

    expect(run.output).not.toContain('receipt-absent');
    expect(run.output).not.toContain('staging approval');
  });
});
