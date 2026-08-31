// packages/backend/discord-bot/src/lib/constants.ts
//
// Guild/role/channel/forum-tag ids now live in @aikami/constants
// (packages/shared/constants/src/lib/discord.ts) — the single source of
// truth, kept in sync BY HAND with scripts/src/lib/discord/structure.ts
// (see that file's header comment). This module re-exports the subset this
// package uses under its existing local names, plus the bot-specific bits
// (the issue-trigger phrase, the tool-access map) that have no reason to
// live in a shared package.

import {
  DISCORD_CHANNELS,
  DISCORD_FORUM_TAG_LABELS,
  DISCORD_GUILD_ID,
  DISCORD_ROLES,
} from '@aikami/constants';

export const GUILD_ID = DISCORD_GUILD_ID;
export const FORUM_CHANNEL_ID = DISCORD_CHANNELS.support;
export const MODERATOR_ROLE_ID = DISCORD_ROLES.moderator;
export const ADMIN_ROLE_ID = DISCORD_ROLES.admin;
export const FORUM_TAG_LABELS = DISCORD_FORUM_TAG_LABELS;

/** Case-insensitive phrase a Moderator/Admin mentions the bot with to open a GitHub issue from a thread. */
export const ISSUE_TRIGGER_REGEX = /github issue/i;

// ── C-449 AC-5: Channel → tool access mapping ───────────────────────────
//
// When a Discord member has access to a channel listed here, they are granted
// access to the associated third-party tool(s). When they lose access, the
// grant is revoked.
//
// This is the source of truth — update it when channels or tools change.

export const CHANNEL_TOOL_ACCESS = [
  {
    // #support forum channel (renamed from #bugs-features-requests)
    channelId: FORUM_CHANNEL_ID,
    tools: [{ toolId: 'github-issues', label: 'GitHub Issue Creation' }],
  },
  // Future mappings:
  // {
  //   channelId: '...llm-beta-channel...',
  //   tools: [
  //     { toolId: 'llm-chat', label: 'LLM Chat Access' },
  //   ],
  // },
] as const;
