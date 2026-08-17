// scripts/src/lib/discord/structure.ts
//
// Declarative desired state for the Aikami Discord server — the single
// source of truth `sync.ts` reconciles the live guild against. Edit this
// file and run a sync instead of clicking around in Discord, so the server
// layout is reviewable in git like any other config.
//
// Bootstrapping from an existing server: run
//   bun run scripts -- discord/index.ts audit --format=structure
// to print a paste-ready seed built from what's live right now, then trim
// it down to what you actually want to manage declaratively.
//
// Matching: categories/channels/roles are matched to live Discord objects
// BY NAME (case-sensitive). Renaming something here creates a new one and
// leaves the old one dangling — rename in Discord first (or via `sync
// --apply`, which only ever creates/updates) then update the name here.
//
// Safety: `sync --apply` only ever CREATES or UPDATES. Nothing declared
// here (or removed from here) ever deletes a live channel/role unless you
// also pass `--prune` — see sync.ts.

import { PermissionFlagsBits } from 'discord-api-types/v10';

export type DesiredRole = {
  name: string;
  /** 0xRRGGBB, e.g. 0x6d28d9. Omit for Discord's default (no color). */
  color?: number;
  /** Show this role's members separately in the member list. */
  hoist?: boolean;
  /** Allow anyone to @mention this role. */
  mentionable?: boolean;
  /** Permission bitfield as a string, e.g. "0" for no permissions. */
  permissions?: string;
};

export type DesiredChannelType = 'text' | 'voice' | 'announcement' | 'forum' | 'stage';

/** Any key of discord-api-types' PermissionFlagsBits, e.g. "ViewChannel". */
export type PermissionName = keyof typeof PermissionFlagsBits;

/**
 * A role-scoped permission overwrite for one channel. `role: '@everyone'`
 * targets the guild's default role (Discord's own convention — its role id
 * always equals the guild id).
 */
export type DesiredPermissionOverwrite = {
  role: string;
  allow?: PermissionName[];
  deny?: PermissionName[];
};

export type DesiredChannel = {
  name: string;
  type: DesiredChannelType;
  /** Must match a DesiredCategory.name below, or omit for top-level. */
  category?: string;
  topic?: string;
  nsfw?: boolean;
  /**
   * COMPLETE desired set of role-based view/send overwrites for this
   * channel — like every other field here, this replaces whatever's live,
   * it doesn't merge. Omit entirely to leave a channel's permissions
   * untouched (sync never sends an empty array over live overwrites).
   */
  permissionOverwrites?: DesiredPermissionOverwrite[];
};

/** Sums named permission flags into the decimal bitfield string Discord's API expects. */
export function permissionsToBitfield(names: PermissionName[] = []): string {
  let bits = 0n;
  for (const name of names) {
    bits |= PermissionFlagsBits[name];
  }
  return bits.toString();
}

export type DesiredCategory = {
  name: string;
};

export type DesiredStructure = {
  roles: DesiredRole[];
  categories: DesiredCategory[];
  channels: DesiredChannel[];
};

// ─── Edit below this line ───────────────────────────────────────────────

export const structure: DesiredStructure = {
  roles: [
    // Full server admins. Kept separate from the "AiKami Bot" managed role
    // (which already has Administrator on its own).
    {
      name: 'Admin',
      color: 0xe74c3c,
      hoist: true,
      mentionable: true,
      permissions: permissionsToBitfield(['Administrator']),
    },
    // Moderation toolkit, no server-admin access.
    {
      name: 'Moderator',
      color: 0x3498db,
      hoist: true,
      mentionable: true,
      permissions: permissionsToBitfield([
        'KickMembers',
        'BanMembers',
        'ManageMessages',
        'ManageNicknames',
        'MuteMembers',
        'DeafenMembers',
        'MoveMembers',
      ]),
    },
    // Plain tag role, no guild permissions — a trusted-tester/builder
    // allow-list role. Bug reports and feature requests go through the
    // #bugs-features-requests forum (moderator-triggered GitHub issue
    // creation — see packages/backend/discord-bot/src/lib/github_issue.ts
    // and constants.ts's MODERATOR_ROLE_ID/ADMIN_ROLE_ID), not this role.
    {
      name: 'Contributor',
      color: 0x2ecc71,
      hoist: true,
      mentionable: false,
      permissions: permissionsToBitfield([]),
    },
    // Pre-existing — pre-release testers, gates #releases-staging below.
    { name: 'staging', color: 0, hoist: false, mentionable: false, permissions: '0' },
  ],
  categories: [
    { name: 'Information' },
    { name: 'Text Channels' },
    { name: 'Voice Channels' },
    { name: 'Support' },
    { name: 'Staff' },
  ],
  channels: [
    { name: 'welcome', type: 'text', category: 'Information' },
    // Read-only for everyone — moved into Information from top-level.
    {
      name: 'rules',
      type: 'text',
      category: 'Information',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    { name: 'announcements', type: 'text', category: 'Information' },
    { name: 'resources', type: 'text', category: 'Information' },
    // Dev-activity firehose — hidden from default members, visible to
    // anyone actively building/contributing.
    {
      name: 'github-feed',
      type: 'text',
      category: 'Information',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        { role: 'Moderator', allow: ['ViewChannel'] },
        { role: 'Contributor', allow: ['ViewChannel'] },
      ],
    },
    { name: 'releases', type: 'text', category: 'Information' },
    // Fixes a leftover no-op overwrite (deny:"0") — actually gate this to
    // pre-release testers now.
    {
      name: 'releases-staging',
      type: 'text',
      category: 'Information',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'staging', allow: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
      ],
    },
    { name: 'general', type: 'text', category: 'Text Channels' },
    { name: 'off-topic', type: 'text', category: 'Text Channels' },
    { name: 'Lounge', type: 'voice', category: 'Voice Channels' },
    { name: 'Meeting Room', type: 'voice', category: 'Voice Channels' },
    // Curated, read-only — staff post/edit answers, everyone else reads.
    {
      name: 'faq',
      type: 'text',
      category: 'Support',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    // One forum for bug reports, feature requests, and questions/help —
    // the only way to file a bug/feature now (no /bug or /feature command).
    // A moderator reviews each post and, if valid, turns it into a GitHub
    // issue by @mentioning the bot in-thread (separate always-on Gateway
    // bot service, not this Cloud Function).
    { name: 'bugs-features-requests', type: 'forum', category: 'Support' },
    // Moved into the new Staff category from top-level.
    {
      name: 'private',
      type: 'text',
      category: 'Staff',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
      ],
    },
    {
      name: 'moderator-only',
      type: 'text',
      category: 'Staff',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        { role: 'Moderator', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
  ],
};
