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

const { commitsInRange, latestStableTag, setTag } = await import('../github');

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
});
