// scripts/src/lib/release/__tests__/github.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';

const commands: string[][] = [];
const responses: { out: string; err: string; code: number }[] = [];

const run = mock(async (command: string[]) => {
  commands.push(command);
  return responses.shift() ?? { out: '', err: '', code: 0 };
});

mock.module('../../cli_utils', () => ({
  c: { dim: '', reset: '' },
  log: () => undefined,
  run,
}));

const {
  acquireReleaseLock,
  commitsInRange,
  inFlightReleaseRun,
  latestStableTag,
  pushBranch,
  releaseReleaseLock,
  setTag,
} = await import('../github');

describe('release git helpers', () => {
  beforeEach(() => {
    commands.length = 0;
    responses.length = 0;
  });

  test('propagates git read failures instead of treating them as empty results', async () => {
    responses.push({ out: '', err: 'bad revision', code: 128 });
    await expect(commitsInRange('missing..HEAD')).rejects.toThrow('failed (exit 128)');

    responses.push({ out: '', err: 'repository unavailable', code: 128 });
    await expect(latestStableTag()).rejects.toThrow('failed (exit 128)');
  });

  test('keeps empty results for successful git reads', async () => {
    responses.push({ out: '', err: '', code: 0 }, { out: '', err: '', code: 0 });
    expect(await commitsInRange('HEAD..HEAD')).toEqual([]);
    expect(await latestStableTag()).toBeNull();
  });

  test('uses force only when the caller explicitly requests it', async () => {
    await setTag({
      tag: 'staging',
      sha: '1234567890',
      message: 'Staging',
      force: true,
      dryRun: false,
    });
    expect(commands[0]).toContain('-f');
    expect(commands[1]).toContain('--force');

    commands.length = 0;
    await setTag({
      tag: 'v1.2.3',
      sha: '1234567890',
      message: 'Release',
      force: false,
      dryRun: false,
    });
    expect(commands[0]).not.toContain('-f');
    expect(commands[1]).not.toContain('--force');
  });

  test('pushBranch pushes a fully-qualified ref, never a bare branch name', async () => {
    await pushBranch({ branch: 'staging', dryRun: false });
    // A bare `git push origin staging` is ambiguous once a `staging` tag
    // exists — the rolling tag shares the branch name on the second cut on.
    expect(commands[0]).toEqual(['git', 'push', 'origin', 'HEAD:refs/heads/staging']);
  });

  test('pushBranch dry-run records no git command', async () => {
    await pushBranch({ branch: 'staging', dryRun: true });
    expect(commands).toHaveLength(0);
  });

  test('release lock atomically creates and deletes a shared remote ref', async () => {
    responses.push({ out: '1234567890', err: '', code: 0 });

    const lock = await acquireReleaseLock({ branch: 'staging', dryRun: false });
    expect(commands[0]).toEqual(['git', 'rev-parse', 'HEAD']);
    expect(commands[1]).toEqual([
      'gh',
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/git/refs',
      '-f',
      'ref=refs/heads/release-lock/staging',
      '-f',
      'sha=1234567890',
    ]);

    await releaseReleaseLock({ lock, dryRun: false });
    expect(commands[2]).toEqual([
      'gh',
      'api',
      '--method',
      'DELETE',
      'repos/{owner}/{repo}/git/refs/heads/release-lock/staging',
    ]);
  });

  test('release lock rejects a concurrent holder', async () => {
    responses.push(
      { out: '1234567890', err: '', code: 0 },
      { out: '', err: 'HTTP 422: Reference already exists', code: 1 },
    );

    await expect(acquireReleaseLock({ branch: 'staging', dryRun: false })).rejects.toThrow(
      'Another release cut already holds the staging lock',
    );
  });

  test('release lock dry-run performs no git or GitHub commands', async () => {
    const lock = await acquireReleaseLock({ branch: 'staging', dryRun: true });
    await releaseReleaseLock({ lock, dryRun: true });
    expect(commands).toHaveLength(0);
  });

  test('inFlightReleaseRun returns the first in-progress release run id', async () => {
    responses.push({ out: '12345\n67890', err: '', code: 0 });
    expect(await inFlightReleaseRun({ branch: 'staging', dryRun: false })).toBe('12345');
    expect(commands[0]).toContain('--event');
    expect(commands[0]).toContain('release');
    expect(commands[0]).toContain('--branch');
    expect(commands[0]).toContain('staging');
  });

  test('inFlightReleaseRun returns null when no run is in progress', async () => {
    responses.push({ out: '', err: '', code: 0 });
    expect(await inFlightReleaseRun({ branch: 'staging', dryRun: false })).toBeNull();
  });

  test('inFlightReleaseRun dry-run performs no gh lookup', async () => {
    expect(await inFlightReleaseRun({ branch: 'staging', dryRun: true })).toBeNull();
    expect(commands).toHaveLength(0);
  });
});
