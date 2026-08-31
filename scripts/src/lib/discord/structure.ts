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
//
// Positions: neither roles nor channels carry a mandatory numeric position
// in this file. Both `DesiredRole.position` and `DesiredChannel.position`
// are optional ESCAPE HATCHES for the rare case declaration order isn't
// enough (e.g. two structure.ts edits landing out of order across
// branches). Left unset (the normal case), diff.ts derives the position
// from ARRAY ORDER: roles top-to-bottom in `structure.roles` (highest
// first), channels top-to-bottom within their category in
// `structure.channels`. This keeps the common case — "reorder by moving
// lines around" — a one-line diff instead of renumbering every sibling.

import {
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  PermissionFlagsBits,
} from 'discord-api-types/v10';

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
  /** Explicit hierarchy position override — see the file header. Rarely needed. */
  position?: number;
};

export type DesiredChannelType = 'text' | 'voice' | 'announcement' | 'forum' | 'stage' | 'media';

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

export type DesiredForumTag = {
  name: string;
  /** Only a MANAGE_THREADS member may apply/remove this tag. */
  moderated?: boolean;
  /** Unicode emoji, e.g. '🐛'. Custom guild emoji (emoji_id) aren't modeled here. */
  emojiName?: string;
};

export type DesiredForumConfig = {
  tags: DesiredForumTag[];
  /**
   * Applied as the channel's `topic` field — Discord's "Post Guidelines" UI
   * for a forum channel and the channel topic are the SAME underlying API
   * field (there is no separate guidelines field). For a forum channel, set
   * this instead of `DesiredChannel.topic`; diff.ts/sync.ts read this one
   * and ignore `DesiredChannel.topic` when `forum` is present.
   */
  postGuidelines?: string;
  /** Unicode emoji shown on the forum's "add reaction" button, e.g. '👍'. */
  defaultReaction?: string;
  defaultLayout?: 'list' | 'gallery';
  defaultSortOrder?: 'latestActivity' | 'creationDate';
};

export type DesiredChannel = {
  name: string;
  type: DesiredChannelType;
  /** Must match a DesiredCategory.name below, or omit for top-level. */
  category?: string;
  /**
   * For a forum channel, prefer `forum.postGuidelines` (same API field) —
   * see DesiredForumConfig. Required on every non-forum channel; there is
   * no "leave it blank" escape hatch, use a TODO(copy) placeholder string
   * instead so a missing topic is visible in the plan/live channel, not
   * silently absent.
   *
   * EXCEPTION: voice/stage channels have no topic field at all — Discord
   * rejects any string sent as one (confirmed live: `CHANNEL_TOPIC_INVALID`
   * fires even for plain "test"). diff.ts/sync.ts never diff or send this
   * for a `type: 'voice' | 'stage'` channel even when declared here — treat
   * it as documentation-only for those two types.
   */
  topic?: string;
  nsfw?: boolean;
  /** Rate-limit-per-user, 0-21600. Omit for no slowmode. */
  slowmodeSeconds?: number;
  /** Only meaningful when `type` is 'forum' or 'media'. */
  forum?: DesiredForumConfig;
  /** Explicit position override within its category — see the file header. Rarely needed. */
  position?: number;
  /**
   * COMPLETE desired set of role-based view/send overwrites for this
   * channel — like every other field here, this replaces whatever's live,
   * it doesn't merge. Omit entirely to leave a channel's permissions
   * untouched (sync never sends an empty array over live overwrites).
   *
   * Only ROLE-type overwrites (Discord's overwrite `type: 0`) are declared
   * or diffed here. A MEMBER-type overwrite (`type: 1` — permissions
   * pinned to one specific user rather than a role) is invisible to diff.ts
   * and never planned for change; it can only drift silently. `discord
   * audit`'s table output prints any live member overwrites it finds so
   * that drift is at least visible, even though it's never reconciled.
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

export type DesiredGuild = {
  verificationLevel?: GuildVerificationLevel;
  explicitContentFilter?: GuildExplicitContentFilter;
  /** Channel name. Community-feature "Rules or Guidelines" channel. */
  rulesChannel?: string;
  /** Channel name. Where Discord posts guild-update announcements (Community feature). */
  publicUpdatesChannel?: string;
  /** Channel name. Where Discord's own safety alerts (raid/spam detection) post. */
  safetyAlertsChannel?: string;
  /** Channel name. Where system join/boost messages post. */
  systemChannel?: string;
  /** Server description shown on the Discord discovery/invite card. */
  description?: string;
};

export type AutoModTriggerKind = 'spam' | 'mentionSpam' | 'keywordPreset' | 'keyword';

export type AutoModKeywordPreset = 'profanity' | 'sexualContent' | 'slurs';

export type DesiredAutoModAction =
  | { type: 'blockMessage'; customMessage?: string }
  | { type: 'alert'; channel: string }
  | { type: 'timeout'; durationSeconds: number };

export type DesiredAutoModRule = {
  name: string;
  trigger: AutoModTriggerKind;
  /** Whether Discord should enforce the rule. Defaults to true. */
  enabled?: boolean;
  /** mentionSpam only. */
  mentionTotalLimit?: number;
  /** mentionSpam only. */
  mentionRaidProtection?: boolean;
  /** keywordPreset only. */
  presets?: AutoModKeywordPreset[];
  /** keyword only — literal substrings (supports Discord's `*wildcard*` syntax). */
  keywordFilter?: string[];
  /** keyword only — Rust-flavored regex, max 10 patterns / 260 chars each. */
  regexPatterns?: string[];
  /** Role names exempt from this rule. */
  exemptRoles?: string[];
  /** Channel names exempt from this rule. */
  exemptChannels?: string[];
  actions: DesiredAutoModAction[];
};

export type DesiredStructure = {
  guild?: DesiredGuild;
  roles: DesiredRole[];
  categories: DesiredCategory[];
  channels: DesiredChannel[];
  automod?: DesiredAutoModRule[];
};

// ─── Edit below this line ───────────────────────────────────────────────

export const structure: DesiredStructure = {
  guild: {
    // Set in Discord UI by Task 1 (Server Settings → Safety Setup); declared
    // here too so a future manual change drifts back via `sync --apply`.
    verificationLevel: GuildVerificationLevel.Medium,
    // MFA level is read-only and is not managed by declarative sync.
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
    rulesChannel: 'rules',
    // NOT set: publicUpdatesChannel — Discord silently refuses to change
    // `public_updates_channel_id` for this guild (confirmed live: PATCH
    // returns 200 with a DIFFERENT channel id than the one sent, no matter
    // what's sent or what type it is — this field is gated on server
    // eligibility we don't have, not on channel type). Declaring it here
    // would just be permanent no-op diff noise on every future sync.
    //
    // NOT set: safetyAlertsChannel — Discord's API rejects
    // safety_alerts_channel_id for any channel @everyone can't view
    // (confirmed live — `safety_alerts_channel_id[INVALID_CHANNEL]` against
    // #staff, which denies @everyone ViewChannel by design). Pointing it at
    // a public channel instead would put raid/spam alerts where the
    // raiders can see them, which defeats the purpose. The `automod` rules
    // below already route every rule's alert action to #staff directly —
    // the equivalent notification without the public-channel requirement.
    systemChannel: 'welcome',
    description: 'TODO(copy): one-line server description for the Discord discovery card.',
  },
  roles: [
    // Hierarchy order, highest first (see the file header on positions).
    // "AiKami Bot" (managed) is NEVER declared here — Discord forbids
    // editing a managed role, and Task 1 already put it above Admin by hand.
    {
      name: 'Admin',
      color: 0xe74c3c,
      hoist: true,
      mentionable: true,
      permissions: permissionsToBitfield(['Administrator']),
    },
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
    // Awarded manually — never self-selected via onboarding, unlike the
    // plain tag roles below.
    {
      name: 'Contributor',
      color: 0x2ecc71,
      hoist: true,
      mentionable: false,
      permissions: permissionsToBitfield([]),
    },
    // Plain tag roles — no guild permissions, self-selected via onboarding
    // (see TASK 3's onboarding prompts). Gate channel visibility only.
    { name: 'Developer', color: 0x9b59b6, hoist: false, mentionable: false, permissions: '0' },
    { name: 'Creator', color: 0xf39c12, hoist: false, mentionable: false, permissions: '0' },
    // Pre-existing (renamed from "staging" in Task 1) — pre-release
    // testers, gates #releases-staging below.
    { name: 'Beta Tester', color: 0, hoist: false, mentionable: false, permissions: '0' },
    { name: 'Player', color: 0, hoist: false, mentionable: false, permissions: '0' },
    // Notification-only role, deliberately mentionable so the release
    // notifier (TASK 4) can @-ping it.
    { name: 'Release Pings', color: 0, hoist: false, mentionable: true, permissions: '0' },
  ],
  categories: [
    { name: 'Start here' },
    { name: 'Community' },
    { name: 'Build & play' },
    { name: 'Developers' },
    { name: 'Staff' },
  ],
  channels: [
    // ── Start here — read-only ─────────────────────────────────────────
    {
      name: 'welcome',
      type: 'text',
      category: 'Start here',
      topic: 'TODO(copy): welcome message topic.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    {
      name: 'rules',
      type: 'text',
      category: 'Start here',
      topic: 'TODO(copy): six-line rules summary.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    {
      name: 'announcements',
      type: 'announcement',
      category: 'Start here',
      topic: 'TODO(copy): announcements topic.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    {
      name: 'releases',
      type: 'announcement',
      category: 'Start here',
      topic: 'TODO(copy): desktop release announcements topic.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    // ── Community ────────────────────────────────────────────────────
    {
      name: 'general',
      type: 'text',
      category: 'Community',
      topic: 'TODO(copy): general chat topic.',
    },
    // NEW. Declared 'media' in the plan (matching the task spec), but
    // Discord's REST API rejects `type: 16` (GuildMedia) channel creation
    // for this guild outright (50024 "Cannot execute action on this
    // channel type" — confirmed against the live API; a same-payload forum
    // probe succeeds). A forum channel with a gallery layout is the closest
    // working approximation: same picture-forward post grid, just with a
    // (hidden by default in most clients) text body per post. Switch this
    // back to 'media' if Discord later allows bot-created media channels
    // for this guild.
    {
      name: 'showcase',
      type: 'forum',
      category: 'Community',
      forum: {
        tags: [],
        postGuidelines: 'TODO(copy): showcase guidelines — screenshots, builds, art.',
        defaultLayout: 'gallery',
      },
    },
    {
      name: 'off-topic',
      type: 'text',
      category: 'Community',
      topic: 'TODO(copy): off-topic chat topic.',
    },
    // Voice channels have no # prefix in TASK 2's channel table (that's a
    // display convention, not a rename instruction) — kept at their live
    // names ("Lounge", "Meeting Room") so these UPDATE in place instead of
    // creating duplicates and orphaning the existing two.
    {
      name: 'Lounge',
      type: 'voice',
      category: 'Community',
      topic: 'TODO(copy): lounge voice topic.',
    },
    {
      name: 'Meeting Room',
      type: 'voice',
      category: 'Community',
      topic: 'TODO(copy): meeting-room voice topic.',
    },
    // ── Build & play ────────────────────────────────────────────────
    {
      name: 'faq',
      type: 'text',
      category: 'Build & play',
      topic: 'TODO(copy): FAQ topic.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    // Renamed from "bugs-features-requests" in Task 1. Keeps the three
    // existing forum tags, adds Content + Solved.
    {
      name: 'support',
      type: 'forum',
      category: 'Build & play',
      forum: {
        tags: [
          { name: 'Bug' },
          { name: 'Feature Request' },
          { name: 'Question' },
          { name: 'Content', emojiName: '🎨' },
          { name: 'Solved', emojiName: '✅', moderated: true },
        ],
        postGuidelines: 'TODO(copy): support forum post guidelines.',
        defaultReaction: '👍',
        defaultLayout: 'list',
        defaultSortOrder: 'latestActivity',
      },
    },
    // ── Developers — visible to Developer, Admin, Moderator only ───────
    //
    // Every deny-@everyone channel from here down also explicitly allows
    // the "AiKami Bot" role — Task 1 rescoped the bot OFF Administrator
    // (which used to bypass every channel overwrite for free), so without
    // an explicit grant the bot loses access to its own private channels:
    // confirmed live (403 "Missing Access" applying this exact plan
    // pre-fix). `permissionOverwrites` may reference the managed "AiKami
    // Bot" role by name here even though structure.roles never DECLARES it
    // — those are different things (see structure.roles' comment).
    // NEW.
    {
      name: 'dev',
      type: 'text',
      category: 'Developers',
      topic: 'TODO(copy): dev chat topic.',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Developer', allow: ['ViewChannel'] },
        { role: 'Moderator', allow: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        { role: 'AiKami Bot', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
    // NEW, read-only.
    {
      name: 'pull-requests',
      type: 'text',
      category: 'Developers',
      topic: 'TODO(copy): pull-requests firehose topic.',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Developer', allow: ['ViewChannel'], deny: ['SendMessages'] },
        { role: 'Moderator', allow: ['ViewChannel'], deny: ['SendMessages'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        // TASK 4 posts the merged-PR firehose here through the bot's own
        // identity — needs Send in addition to View.
        { role: 'AiKami Bot', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
    // NEW, read-only.
    {
      name: 'merged',
      type: 'text',
      category: 'Developers',
      topic: 'TODO(copy): merged-PR firehose topic.',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Developer', allow: ['ViewChannel'], deny: ['SendMessages'] },
        { role: 'Moderator', allow: ['ViewChannel'], deny: ['SendMessages'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        { role: 'AiKami Bot', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
    // Beta Tester + Admin only — NOT the general Developers visibility rule.
    {
      name: 'releases-staging',
      type: 'text',
      category: 'Developers',
      topic: 'TODO(copy): pre-release build announcements topic.',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Beta Tester', allow: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        { role: 'AiKami Bot', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
    // ── Staff ───────────────────────────────────────────────────────
    // Renamed from "moderator-only" in Task 1.
    {
      name: 'staff',
      type: 'text',
      category: 'Staff',
      topic: 'TODO(copy): staff chat + alerts topic.',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Moderator', allow: ['ViewChannel', 'SendMessages'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        // Deploy-failure notifications (TASK 4) and AutoMod alert actions
        // post/read here through the bot's own identity.
        { role: 'AiKami Bot', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
    // Renamed from "private" in Task 1.
    {
      name: 'admin',
      type: 'text',
      category: 'Staff',
      topic: 'TODO(copy): admin-only topic.',
      permissionOverwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'Admin', allow: ['ViewChannel'] },
        { role: 'AiKami Bot', allow: ['ViewChannel', 'SendMessages'] },
      ],
    },
    // "resources" and "github-feed" are retired — deliberately declared
    // nowhere. They show up in the plan as deletions and stay untouched
    // until `sync --apply --prune`.
  ],
  automod: [
    { name: 'Spam', trigger: 'spam', actions: [{ type: 'alert', channel: 'staff' }] },
    // Reuses the existing rule (id 1030554520465440818) by NAME — matching
    // is name-based same as everything else here, so this updates it in
    // place instead of creating a second mention-spam rule.
    {
      name: 'Block Mention Spam',
      trigger: 'mentionSpam',
      mentionTotalLimit: 8,
      mentionRaidProtection: true,
      actions: [{ type: 'blockMessage' }, { type: 'alert', channel: 'staff' }],
    },
    {
      name: 'Blocked Keyword Presets',
      trigger: 'keywordPreset',
      presets: ['slurs', 'sexualContent'],
      actions: [{ type: 'blockMessage' }, { type: 'alert', channel: 'staff' }],
    },
    {
      name: 'Blocked Invite Links',
      trigger: 'keyword',
      regexPatterns: ['discord\\.gg/', 'discord\\.com/invite/'],
      exemptRoles: ['Admin', 'Moderator', 'Contributor'],
      actions: [{ type: 'blockMessage' }, { type: 'alert', channel: 'staff' }],
    },
  ],
};
