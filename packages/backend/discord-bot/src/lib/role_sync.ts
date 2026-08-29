// packages/backend/discord-bot/src/lib/role_sync.ts
//
// C-449 AC-5: Discord bot role-sync — maps channel membership to third-party
// tool access grants. Triggered on GuildMemberUpdate and channel permission
// change events.
//
// The channel→tool mapping is defined in constants.ts (CHANNEL_TOOL_ACCESS).
// When a user joins a mapped channel, they gain access to the associated tool;
// when they leave, access is revoked.

import { logger } from '@aikami/logger';
import { type GuildMember, type PartialGuildMember, TextChannel } from 'discord.js';
import { CHANNEL_TOOL_ACCESS } from './constants';

// ── Types ────────────────────────────────────────────────────────────────

export type ToolAccess = {
  /** Tool identifier, e.g. 'github-issues', 'llm-chat'. */
  toolId: string;
  /** Human-readable label. */
  label: string;
};

export type ChannelToolMapping = {
  channelId: string;
  tools: ToolAccess[];
};

// ── Grant / Revoke (placeholder implementations) ─────────────────────────
//
// These functions are stubs — the actual integration with each tool's API
// (e.g., granting a GitHub repo collaborator role, enabling an LLM API key)
// depends on the tool and will be implemented per-tool in future contracts.
// For now, logging is the integration.

async function grantToolAccess(member: GuildMember, tool: ToolAccess): Promise<void> {
  logger.info(
    `role-sync: grant "${tool.label}" (${tool.toolId}) to ${member.user.tag} (${member.id})`,
  );
  // TODO: Implement actual tool grant logic per toolId:
  //   'github-issues' → add member to GitHub repo as triager
  //   'llm-chat'      → enable LLM API key for this user
  //   'admin-tools'   → add admin role in internal tools
}

async function revokeToolAccess(member: GuildMember, tool: ToolAccess): Promise<void> {
  logger.info(
    `role-sync: revoke "${tool.label}" (${tool.toolId}) from ${member.user.tag} (${member.id})`,
  );
  // TODO: Implement actual tool revocation logic per toolId
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Sync a member's tool access based on their current channel memberships.
 * Called when a member's channel permissions change or on guild member update.
 *
 * @param member The guild member whose access should be synced.
 * @param channelIds The channel IDs the member currently has access to.
 */
export async function syncMemberToolAccess(
  member: GuildMember,
  channelIds: string[],
): Promise<void> {
  const memberChannels = new Set(channelIds);

  for (const mapping of CHANNEL_TOOL_ACCESS) {
    const hasAccess = memberChannels.has(mapping.channelId);

    for (const tool of mapping.tools) {
      if (hasAccess) {
        await grantToolAccess(member, tool);
      } else {
        await revokeToolAccess(member, tool);
      }
    }
  }

  logger.debug(`role-sync: synced ${member.user.tag} — ${channelIds.length} channel(s) evaluated`);
}

/**
 * Handle a GuildMemberUpdate event — sync tool access when a member's roles
 * or channel permissions change.
 */
export async function handleGuildMemberUpdate(
  _oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  // Get the channels the member can see (iterate over guild channels)
  const accessibleChannels: string[] = [];

  // Only process if the member data is complete (not partial)
  if (!newMember.guild.available) {
    return;
  }

  // Check each text channel the member has permission to view
  for (const [, channel] of newMember.guild.channels.cache) {
    if (channel.isTextBased() && channel instanceof TextChannel) {
      const permissions = channel.permissionsFor(newMember);
      if (permissions?.has('ViewChannel')) {
        accessibleChannels.push(channel.id);
      }
    }
  }

  await syncMemberToolAccess(newMember, accessibleChannels);
}
