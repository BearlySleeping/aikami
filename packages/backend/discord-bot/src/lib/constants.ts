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

// C-449 AC-5's channel → tool access mapping (CHANNEL_TOOL_ACCESS) and its
// role_sync.ts consumer were removed in TASK 3c of the Discord revamp:
// grantToolAccess/revokeToolAccess only ever wrote log lines (no real tool
// was ever wired up), and the ChannelUpdate handler that drove it called
// guild.members.fetch() — every member — on every single channel
// permission edit. Dead weight, not a real feature to preserve.
