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

/** A selectable onboarding answer and the access it grants. */
export type DesiredOnboardingOption = {
  /** Unicode emoji shown next to the option, e.g. '🎮'. */
  emojiName: string;
  title: string;
  description?: string;
  /** Role names granted when a member selects this option. */
  roles?: string[];
  /** Channel names a member is opted into when they select this option. */
  channels?: string[];
};

/** A question presented to new members during guild onboarding. */
export type DesiredOnboardingPrompt = {
  title: string;
  /** Members may pick only one option. Defaults to false (multi-select). */
  singleSelect?: boolean;
  /** Must be answered before onboarding completes. Defaults to false. */
  required?: boolean;
  /** Shown in the onboarding flow itself, not just Channels & Roles. Defaults to true. */
  inOnboarding?: boolean;
  options: DesiredOnboardingOption[];
};

/** Declarative guild onboarding configuration. */
export type DesiredOnboarding = {
  enabled: boolean;
  /** 'default' counts only defaultChannels toward Discord's eligibility requirements; 'advanced' also counts prompts. */
  mode: 'default' | 'advanced';
  /** Channel names every member is opted into automatically. */
  defaultChannels: string[];
  prompts: DesiredOnboardingPrompt[];
};

/** A channel featured on the guild welcome screen. */
export type DesiredWelcomeChannel = {
  /** Channel name. */
  channel: string;
  description: string;
  /** Unicode emoji shown to the left of the channel, e.g. '👋'. */
  emojiName?: string;
};

/** Declarative guild welcome-screen content and channel order. */
export type DesiredWelcomeScreen = {
  description: string;
  channels: DesiredWelcomeChannel[];
};

export type DesiredStructure = {
  guild?: DesiredGuild;
  roles: DesiredRole[];
  categories: DesiredCategory[];
  channels: DesiredChannel[];
  automod?: DesiredAutoModRule[];
  onboarding?: DesiredOnboarding;
  welcomeScreen?: DesiredWelcomeScreen;
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
    description: 'An open-source, AI-native RPG. Plays offline. Yours to modify.',
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
      topic: 'Start here — say hello, then check #rules and #faq.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    {
      name: 'rules',
      type: 'text',
      category: 'Start here',
      topic: 'Please read before posting.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    {
      name: 'announcements',
      type: 'announcement',
      category: 'Start here',
      topic: 'Official Aikami announcements — read-only.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    {
      name: 'releases',
      type: 'announcement',
      category: 'Start here',
      topic: 'Desktop build announcements — read-only.',
      permissionOverwrites: [{ role: '@everyone', deny: ['SendMessages'] }],
    },
    // ── Community ────────────────────────────────────────────────────
    {
      name: 'general',
      type: 'text',
      category: 'Community',
      topic: 'General chat about Aikami — the game, the code, anything else.',
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
        tags: [
          { name: 'Character', emojiName: '🧑' },
          { name: 'World', emojiName: '🗺️' },
          { name: 'Art', emojiName: '🎨' },
          { name: 'Pack', emojiName: '📦' },
          { name: 'Video', emojiName: '🎥' },
        ],
        postGuidelines:
          'Share your characters, worlds, art, and builds. One post per creation — screenshots or clips welcome.',
        // Set manually in Discord's UI (not part of the original plan) —
        // declared here so a future sync doesn't wipe it back to none.
        defaultReaction: '💪',
        defaultLayout: 'gallery',
      },
    },
    {
      name: 'ai-stuff',
      type: 'text',
      category: 'Community',
      topic: 'AI news, tools, and anything interesting from the world of AI.',
    },
    {
      name: 'tavern-dwellers',
      type: 'text',
      category: 'Community',
      topic: 'No landlubbers allowed.',
    },
    // Voice channels have no # prefix in TASK 2's channel table (that's a
    // display convention, not a rename instruction) — kept at their live
    // names ("Lounge", "Meeting Room") so these UPDATE in place instead of
    // creating duplicates and orphaning the existing two.
    {
      name: 'Lounge',
      type: 'voice',
      category: 'Community',
      topic: 'Casual voice hangout.',
    },
    {
      name: 'Meeting Room',
      type: 'voice',
      category: 'Community',
      topic: 'Voice channel for scheduled meetings and pairing sessions.',
    },
    // ── Build & play ────────────────────────────────────────────────
    {
      name: 'faq',
      type: 'text',
      category: 'Build & play',
      topic: 'Frequently asked questions — read-only, curated by staff.',
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
        postGuidelines:
          'Bug reports, feature requests, and questions. One thread per topic. Include steps to reproduce for bugs. A moderator will follow up.',
        // Set manually in Discord's UI (was 👍) — declared here so a future
        // sync doesn't revert it.
        defaultReaction: '✅',
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
      topic: 'Development discussion for contributors.',
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
      topic: 'Live PR firehose from GitHub — read-only.',
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
      topic: 'Merged PRs — what shipped, and when.',
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
      topic: 'Pre-release desktop builds for beta testers — things here might be broken.',
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
      topic: 'Staff-only chat and moderation alerts.',
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
      topic: 'Admin-only.',
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
    // Intentionally NOT declared: a keyword-preset rule blocking Discord's
    // built-in slurs/sexual-content wordlists. Reject on sight if it comes
    // back in a future edit — that's a deliberate moderation-policy call,
    // not an oversight.
    {
      name: 'Blocked Invite Links',
      trigger: 'keyword',
      regexPatterns: ['discord\\.gg/', 'discord\\.com/invite/'],
      exemptRoles: ['Admin', 'Moderator', 'Contributor'],
      actions: [{ type: 'blockMessage' }, { type: 'alert', channel: 'staff' }],
    },
  ],
  onboarding: {
    enabled: true,
    mode: 'advanced',
    // 10 defaults; exactly 5 are @everyone-writable (general, showcase,
    // ai-stuff, support, Lounge — the other 5 deny @everyone SendMessages
    // above), matching Discord's "≥7 defaults, ≥5 writable" minimum with no
    // slack to spare. If `sync --apply` for onboarding ever fails with
    // `below_requirements`, that's the constraint to check first.
    defaultChannels: [
      'welcome',
      'rules',
      'announcements',
      'releases',
      'general',
      'showcase',
      'ai-stuff',
      'faq',
      'support',
      'Lounge',
    ],
    prompts: [
      {
        title: 'What brings you to Aikami?',
        singleSelect: false,
        required: false,
        inOnboarding: true,
        options: [
          {
            emojiName: '🎮',
            title: 'Playing the game',
            description: "I'm here to play, and to see what other people build.",
            roles: ['Player'],
          },
          {
            emojiName: '🎨',
            title: 'Making content',
            description: 'Characters, worlds, art, packs for the hub.',
            roles: ['Creator'],
            channels: ['showcase'],
          },
          {
            emojiName: '💻',
            title: 'Building Aikami',
            description: 'Reading and writing the code.',
            roles: ['Developer'],
            channels: ['dev', 'pull-requests', 'merged'],
          },
        ],
      },
      {
        title: 'Want a ping when a build ships?',
        singleSelect: true,
        required: false,
        inOnboarding: true,
        options: [
          {
            emojiName: '🔔',
            title: 'Stable releases',
            description: 'A ping when a desktop build goes out.',
            roles: ['Release Pings'],
            channels: ['releases'],
          },
          {
            emojiName: '🧪',
            title: 'Stable and pre-release',
            description: 'Everything, including the builds that might be broken.',
            roles: ['Release Pings', 'Beta Tester'],
            channels: ['releases', 'releases-staging'],
          },
        ],
      },
    ],
  },
  welcomeScreen: {
    description: 'An open-source, AI-native RPG. Plays offline. Yours to modify.',
    channels: [
      { channel: 'welcome', description: 'Start here', emojiName: '👋' },
      { channel: 'rules', description: 'Read the rules', emojiName: '📜' },
      { channel: 'general', description: 'Say hello', emojiName: '💬' },
      { channel: 'showcase', description: 'See what people made', emojiName: '🖼️' },
      { channel: 'support', description: 'Bugs, ideas, questions', emojiName: '🐛' },
    ],
  },
};
