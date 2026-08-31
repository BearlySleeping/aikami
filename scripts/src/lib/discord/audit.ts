// scripts/src/lib/discord/audit.ts
//
// Read-only export of the live guild's roles, categories, and channels.
// Makes no writes — safe to run anytime, including before DISCORD_BOT_TOKEN
// has Manage permissions (Read-only intents/scopes are enough).
//
// --format=structure prints a paste-ready seed for structure.ts, built from
// what's live right now — the intended way to bootstrap the declarative
// config from an existing server instead of typing it out by hand.

import { ChannelType } from 'discord-api-types/v10';
import { c, log, ok } from '../cli_utils';
import { listChannels } from './channels';
import { initDiscordClient } from './client';
import { listRoles } from './roles';
import type { DesiredChannelType } from './structure';
import type { GuildChannel, GuildRole } from './types';

const CHANNEL_TYPE_TO_DESIRED: Partial<Record<ChannelType, DesiredChannelType>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildStageVoice]: 'stage',
};

const CHANNEL_TYPE_LABEL: Record<number, string> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildStageVoice]: 'stage',
};

function quote(s: string): string {
  return JSON.stringify(s);
}

/**
 * MEMBER-type overwrites (`type: 1` — permissions pinned to one specific
 * user rather than a role) are invisible to diff.ts/sync.ts FOREVER: there's
 * no name to declare one by in structure.ts, so a sync can never plan a
 * change for it (see diff.ts's overwriteKeySet comment). Printing them here
 * is the only place their drift is visible at all.
 */
function memberOverwriteCount(ch: GuildChannel): number {
  return (ch.permission_overwrites ?? []).filter((o) => o.type === 1).length;
}

function printStructureSeed(
  categories: GuildChannel[],
  nonCategory: GuildChannel[],
  roles: GuildRole[],
): void {
  const lines: string[] = [];
  lines.push("// Paste into structure.ts's `structure` export (or merge selectively).");
  lines.push('{');

  lines.push('  roles: [');
  for (const role of roles.filter((r) => r.name !== '@everyone' && !r.managed)) {
    lines.push(
      `    { name: ${quote(role.name)}, color: ${role.color}, hoist: ${role.hoist}, mentionable: ${role.mentionable}, permissions: ${quote(role.permissions)} },`,
    );
  }
  lines.push('  ],');

  lines.push('  categories: [');
  for (const cat of categories) {
    lines.push(`    { name: ${quote(cat.name)} },`);
  }
  lines.push('  ],');

  lines.push('  channels: [');
  for (const ch of nonCategory) {
    const type = CHANNEL_TYPE_TO_DESIRED[ch.type as ChannelType];
    if (!type) {
      // Threads, forum posts, stage sub-objects, etc. — not managed declaratively.
      continue;
    }
    const parent = categories.find((cat) => cat.id === ch.parent_id);
    const parts = [`name: ${quote(ch.name)}`, `type: ${quote(type)}`];
    if (parent) {
      parts.push(`category: ${quote(parent.name)}`);
    }
    if (ch.topic) {
      parts.push(`topic: ${quote(ch.topic)}`);
    }
    if (ch.nsfw) {
      parts.push('nsfw: true');
    }
    lines.push(`    { ${parts.join(', ')} },`);
  }
  lines.push('  ],');
  lines.push('}');

  console.log(lines.join('\n'));
}

export async function runAudit(mode: string, format: string): Promise<void> {
  const { rest, guildId } = initDiscordClient(mode);
  const [channels, roles] = await Promise.all([
    listChannels(rest, guildId),
    listRoles(rest, guildId),
  ]);

  const categories = channels.filter((ch) => ch.type === ChannelType.GuildCategory);
  const nonCategory = channels.filter((ch) => ch.type !== ChannelType.GuildCategory);

  if (format === 'structure') {
    printStructureSeed(categories, nonCategory, roles);
    return;
  }
  if (format === 'json') {
    console.log(JSON.stringify({ channels, roles }, null, 2));
    return;
  }

  log(`Guild ${guildId}`);

  console.log(`\n${c.bold}Roles (${roles.length})${c.reset}`);
  for (const role of [...roles].sort((a, b) => b.position - a.position)) {
    console.log(
      `  ${role.name}  ${c.dim}id=${role.id} color=#${role.color.toString(16).padStart(6, '0')} hoist=${role.hoist} mentionable=${role.mentionable}${c.reset}`,
    );
  }

  console.log(`\n${c.bold}Categories (${categories.length})${c.reset}`);
  for (const cat of [...categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    console.log(`  ${cat.name}  ${c.dim}id=${cat.id}${c.reset}`);
    const inCategory = nonCategory
      .filter((ch) => ch.parent_id === cat.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const ch of inCategory) {
      const memberOverwrites = memberOverwriteCount(ch);
      console.log(
        `    - ${ch.name}  ${c.dim}(${CHANNEL_TYPE_LABEL[ch.type] ?? ch.type}) id=${ch.id}${c.reset}` +
          (memberOverwrites > 0
            ? `  ${c.yellow}⚠ ${memberOverwrites} member-level overwrite(s) — invisible to sync${c.reset}`
            : ''),
      );
    }
  }

  const uncategorized = nonCategory.filter((ch) => !ch.parent_id);
  if (uncategorized.length > 0) {
    console.log(`\n${c.bold}Uncategorized${c.reset}`);
    for (const ch of uncategorized) {
      const memberOverwrites = memberOverwriteCount(ch);
      console.log(
        `  - ${ch.name}  ${c.dim}(${CHANNEL_TYPE_LABEL[ch.type] ?? ch.type}) id=${ch.id}${c.reset}` +
          (memberOverwrites > 0
            ? `  ${c.yellow}⚠ ${memberOverwrites} member-level overwrite(s) — invisible to sync${c.reset}`
            : ''),
      );
    }
  }

  ok(`\n${roles.length} roles, ${categories.length} categories, ${nonCategory.length} channels.`);
}
