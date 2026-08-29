// packages/backend/discord-bot/src/lib/constants.ts
//
// Non-sensitive IDs for the Aikami guild's support forum — plain constants
// rather than Secret Manager fetches, same reasoning as DISCORD_GUILD_ID
// sitting unencrypted in scripts/.env.example: a channel/role snowflake
// isn't a credential. Keep these in sync with scripts/src/lib/discord/
// structure.ts (roles, categories) if the server structure changes.

export const GUILD_ID = '1326946946136408064';
export const FORUM_CHANNEL_ID = '1538878867962466364';
export const MODERATOR_ROLE_ID = '1538729970522652684';
export const ADMIN_ROLE_ID = '1538729969004449882';

export const FORUM_TAG_LABELS: Record<string, string> = {
  '1538881560181211219': 'bug', // Bug
  '1538881560181211220': 'enhancement', // Feature Request
  // "Question" (1538881560181211221) intentionally has no GitHub label —
  // most questions never become an issue.
};

/** Case-insensitive phrase a Moderator/Admin mentions the bot with to open a GitHub issue from a thread. */
export const ISSUE_TRIGGER_REGEX = /github issue/i;

// ── C-449 AC-5: Channel → tool access mapping ───────────────────────────
//
// When a Discord member has access to a channel listed here, they are granted
// access to the associated third-party tool(s). When they lose access, the
// grant is revoked.
//
// This is the source of truth — update it when channels or tools change.

export const CHANNEL_TOOL_ACCESS: readonly {
  channelId: string;
  tools: readonly { toolId: string; label: string }[];
}[] = [
  {
    // #bugs-features-requests forum channel
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
];
