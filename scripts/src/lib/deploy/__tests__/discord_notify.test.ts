// scripts/src/lib/deploy/__tests__/discord_notify.test.ts
//
// Pins the mode→channel mapping for release announcements: a staging release
// must go to #releases-staging, never the public #releases channel. The
// selection lives in notifyDiscordRelease (discord_notify.ts); postToDiscord
// and initScriptsEnv are mocked, and Bun.spawn is stubbed so fetchRelease's
// `gh release view` probe returns a fixed release without spawning the CLI.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const postCalls: Array<{ channel: string; mode?: string }> = [];

mock.module('../../discord/post', () => ({
  postToDiscord: mock(async (options: { channel: string; mode?: string }) => {
    postCalls.push({ channel: options.channel, mode: options.mode });
    return true;
  }),
}));

mock.module('../../env/scripts_env', () => ({
  initScriptsEnv: () => undefined,
  getScriptsEnv: () => undefined,
}));

const { notifyDiscordRelease } = await import('../discord_notify');

const GH_RELEASE_JSON = '{"name":"Test","body":"Notes","url":"https://example.com/releases"}';

const originalSpawn = Bun.spawn;

beforeEach(() => {
  postCalls.length = 0;
  Bun.spawn = mock(() => ({
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(GH_RELEASE_JSON));
        controller.close();
      },
    }),
    stderr: new ReadableStream({ start: (controller) => controller.close() }),
    exited: Promise.resolve(0),
    kill: () => undefined,
  })) as unknown as typeof Bun.spawn;
});

afterEach(() => {
  Bun.spawn = originalSpawn;
});

describe('notifyDiscordRelease channel selection', () => {
  test('staging announcements target the staging channel', async () => {
    await notifyDiscordRelease({ tag: 'staging', mode: 'staging' });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].channel).toBe('releasesStaging');
  });

  test('production announcements target the releases channel', async () => {
    await notifyDiscordRelease({ tag: 'v1.0.0', mode: 'production' });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].channel).toBe('releases');
  });

  test('an omitted mode defaults to production', async () => {
    await notifyDiscordRelease({ tag: 'v1.0.0' });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].channel).toBe('releases');
  });
});
