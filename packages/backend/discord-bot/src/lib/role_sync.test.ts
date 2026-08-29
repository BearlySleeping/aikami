// packages/backend/discord-bot/src/lib/role_sync.test.ts
//
// C-449 AC-5: Unit tests for Discord bot role-sync module.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GuildMember } from 'discord.js';
import { CHANNEL_TOOL_ACCESS } from './constants';
import { syncMemberToolAccess } from './role_sync';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockMember = (id: string, tag: string) =>
  ({
    id,
    user: { tag },
    guild: {
      available: true,
      channels: {
        cache: new Map(),
      },
    },
  }) as unknown as GuildMember;

// ── Tests ────────────────────────────────────────────────────────────────

describe('role_sync (C-449 AC-5)', () => {
  beforeEach(() => {
    mock.module('@aikami/logger', () => ({
      logger: {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
      },
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test('CHANNEL_TOOL_ACCESS maps forum channel to github-issues tool', () => {
    expect(CHANNEL_TOOL_ACCESS.length).toBeGreaterThan(0);
    const forumMapping = CHANNEL_TOOL_ACCESS.find((m) =>
      m.tools.some((t) => t.toolId === 'github-issues'),
    );
    expect(forumMapping).toBeDefined();
    expect(forumMapping?.tools[0].label).toBe('GitHub Issue Creation');
  });

  test('syncMemberToolAccess logs grant for a member with access to a mapped channel', async () => {
    const member = mockMember('user-1', 'TestUser#1234');
    const { logger } = await import('@aikami/logger');

    await syncMemberToolAccess(member, [CHANNEL_TOOL_ACCESS[0].channelId]);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('grant'));
  });

  test('syncMemberToolAccess logs revoke for a member without access to a mapped channel', async () => {
    const member = mockMember('user-2', 'AnotherUser#5678');
    const { logger } = await import('@aikami/logger');

    // Member has access to no channels
    await syncMemberToolAccess(member, []);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('revoke'));
  });

  test('syncMemberToolAccess handles multiple channel mappings', async () => {
    const member = mockMember('user-3', 'MultiUser#9012');
    const { logger } = await import('@aikami/logger');

    // Member has access to all mapped channels
    const allChannelIds = CHANNEL_TOOL_ACCESS.map((m) => m.channelId);
    await syncMemberToolAccess(member, allChannelIds);

    // Should grant for each tool in each mapping
    const grantCalls = (logger.info as ReturnType<typeof mock>).mock.calls.filter(
      (call: string[]) => call[0].includes('grant'),
    );
    expect(grantCalls.length).toBe(CHANNEL_TOOL_ACCESS.reduce((sum, m) => sum + m.tools.length, 0));
  });
});
