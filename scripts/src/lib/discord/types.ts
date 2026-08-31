// scripts/src/lib/discord/types.ts
//
// Minimal local shapes for the subset of the Discord API this module
// touches. discord-api-types models channels as a deep discriminated union
// keyed on `type` (text/voice/forum/thread/... each with different fields),
// which is accurate but painful for generic CRUD helpers that only read/
// write a handful of common fields (name, parent_id, topic, nsfw).
// @discordjs/rest's request body is untyped (`unknown`) regardless, so
// there's no type-safety lost by keeping our own narrower shape here
// instead of fighting the full union.

export type PermissionOverwrite = { id: string; type: 0 | 1; allow: string; deny: string };

export type ForumTag = {
  id: string;
  name: string;
  moderated: boolean;
  emoji_id: string | null;
  emoji_name: string | null;
};

export type ForumDefaultReaction = { emoji_id: string | null; emoji_name: string | null };

export type GuildChannel = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  nsfw?: boolean;
  position?: number;
  rate_limit_per_user?: number;
  permission_overwrites?: PermissionOverwrite[];
  /** Forum/media channels only. */
  available_tags?: ForumTag[];
  default_reaction_emoji?: ForumDefaultReaction | null;
  /** Forum channels only (0 = NotSet, 1 = list, 2 = gallery). */
  default_forum_layout?: number;
  /** Forum/media channels only (0 = latest activity, 1 = creation date). */
  default_sort_order?: number | null;
};

export type GuildRole = {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
  /** Integration-managed (bot roles, etc.) — outside declarative
   *  synchronization: the structure seed filters these out so they never
   *  enter generated sync plans (Discord forbids editing them). */
  managed?: boolean;
};

/**
 * A forum tag payload where `id` is OPTIONAL, not absent: omitting it tells
 * Discord "create a new tag", while including an existing tag's `id` tells
 * Discord "this is that same tag" (used to preserve ids across updates —
 * see ChannelUpdateBody). Shared by both create and update bodies so
 * `buildForumFields` (sync.ts) can build one shape for either call.
 */
export type ForumTagBody = Omit<ForumTag, 'id'> & { id?: string };

export type ChannelCreateBody = {
  name: string;
  type: number;
  parent_id?: string;
  topic?: string;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  permission_overwrites?: PermissionOverwrite[];
  /** Forum/media channels only. */
  available_tags?: ForumTagBody[];
  default_reaction_emoji?: ForumDefaultReaction | null;
  default_forum_layout?: number;
  default_sort_order?: number | null;
};

export type ChannelUpdateBody = Partial<Omit<ChannelCreateBody, 'name' | 'parent_id'>> & {
  /** Null moves a categorized channel to the top level; OMITTING parent_id
   *  leaves the channel where it is. The update payload must permit null so
   *  a planned top-level move can actually be applied. */
  parent_id?: string | null;
};

export type RoleCreateBody = {
  name: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string;
};

export type RoleUpdateBody = Partial<RoleCreateBody>;

// ── Guild settings (guild.ts) ───────────────────────────────────────────

export type GuildSettings = {
  id: string;
  verification_level: number;
  mfa_level: number;
  explicit_content_filter: number;
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  safety_alerts_channel_id: string | null;
  system_channel_id: string | null;
  description: string | null;
};

export type GuildUpdateBody = Partial<Omit<GuildSettings, 'id'>>;

// ── AutoMod (automod.ts) ────────────────────────────────────────────────

export type AutoModTriggerMetadata = {
  keyword_filter?: string[];
  presets?: number[];
  regex_patterns?: string[];
  mention_total_limit?: number;
  mention_raid_protection_enabled?: boolean;
  /**
   * We never send this (structure.ts has no exposed way to declare it),
   * but Discord always echoes it back as `[]` on a live rule — kept here so
   * canonicalizeTriggerMetadata (diff.ts) can normalize it out of the
   * comparison instead of it showing as permanent phantom drift.
   */
  allow_list?: string[];
};

export type AutoModAction = {
  type: number;
  metadata?: { channel_id?: string; duration_seconds?: number; custom_message?: string };
};

export type AutoModRule = {
  id: string;
  guild_id: string;
  name: string;
  event_type: number;
  trigger_type: number;
  trigger_metadata: AutoModTriggerMetadata;
  actions: AutoModAction[];
  enabled: boolean;
  exempt_roles: string[];
  exempt_channels: string[];
};

export type AutoModRuleBody = {
  name: string;
  event_type: number;
  trigger_type: number;
  trigger_metadata?: AutoModTriggerMetadata;
  actions: AutoModAction[];
  enabled?: boolean;
  exempt_roles?: string[];
  exempt_channels?: string[];
};
