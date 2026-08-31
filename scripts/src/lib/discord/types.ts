// scripts/src/lib/discord/types.ts
//
// Local projections of the pinned discord-api-types package. Keep wrappers
// focused on the fields this sync reads while preserving Discord's enums,
// request payloads, and response field types at the API boundary.

import type {
  APIAutoModerationAction,
  APIAutoModerationRule,
  APIAutoModerationRuleTriggerMetadata,
  APIGuild,
  APIGuildChannel,
  APIGuildForumChannel,
  APIGuildForumDefaultReactionEmoji,
  APIGuildForumTag,
  APIOverwrite,
  APIRole,
  RESTPatchAPIAutoModerationRuleJSONBody,
  RESTPatchAPIChannelJSONBody,
  RESTPatchAPIGuildJSONBody,
  RESTPatchAPIGuildRoleJSONBody,
  RESTPostAPIAutoModerationRuleJSONBody,
  RESTPostAPIGuildChannelJSONBody,
  RESTPostAPIGuildRoleJSONBody,
} from 'discord-api-types/v10';

export type PermissionOverwrite = APIOverwrite;

export type ForumTag = APIGuildForumTag;

export type ForumDefaultReaction = APIGuildForumDefaultReactionEmoji;

type GuildChannelBase = Pick<
  APIGuildChannel,
  'id' | 'name' | 'type' | 'parent_id' | 'nsfw' | 'permission_overwrites'
>;

type GuildChannelOptionalFields = Partial<
  Pick<
    APIGuildForumChannel,
    | 'topic'
    | 'position'
    | 'rate_limit_per_user'
    | 'available_tags'
    | 'default_reaction_emoji'
    | 'default_forum_layout'
    | 'default_sort_order'
  >
>;

export type GuildChannel = GuildChannelBase & GuildChannelOptionalFields;

export type GuildRole = Pick<
  APIRole,
  'id' | 'name' | 'color' | 'hoist' | 'mentionable' | 'permissions' | 'position'
> &
  Partial<Pick<APIRole, 'managed'>>;

/**
 * A forum tag payload where `id` is OPTIONAL, not absent: omitting it tells
 * Discord "create a new tag", while including an existing tag's `id` tells
 * Discord "this is that same tag" (used to preserve ids across updates).
 */
export type ForumTagBody = Omit<ForumTag, 'id'> & Partial<Pick<ForumTag, 'id'>>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K & keyof T> : never;

export type ChannelCreateBody = DistributiveOmit<
  RESTPostAPIGuildChannelJSONBody,
  'available_tags' | 'permission_overwrites'
> & {
  available_tags?: ForumTagBody[] | null;
  permission_overwrites?: PermissionOverwrite[];
};

export type ChannelUpdateBody = Omit<
  RESTPatchAPIChannelJSONBody,
  'available_tags' | 'permission_overwrites'
> & {
  available_tags?: ForumTagBody[];
  permission_overwrites?: PermissionOverwrite[] | null;
};

export type RoleCreateBody = RESTPostAPIGuildRoleJSONBody;

export type RoleUpdateBody = RESTPatchAPIGuildRoleJSONBody;

// ── Guild settings (guild.ts) ───────────────────────────────────────────

export type GuildSettings = Pick<
  APIGuild,
  | 'id'
  | 'verification_level'
  | 'mfa_level'
  | 'explicit_content_filter'
  | 'rules_channel_id'
  | 'public_updates_channel_id'
  | 'safety_alerts_channel_id'
  | 'system_channel_id'
  | 'description'
>;

export type GuildUpdateBody = Pick<
  RESTPatchAPIGuildJSONBody,
  | 'verification_level'
  | 'explicit_content_filter'
  | 'rules_channel_id'
  | 'public_updates_channel_id'
  | 'safety_alerts_channel_id'
  | 'system_channel_id'
  | 'description'
>;

// ── AutoMod (automod.ts) ────────────────────────────────────────────────

export type AutoModTriggerMetadata = APIAutoModerationRuleTriggerMetadata;

export type AutoModAction = APIAutoModerationAction;

/** Creator identity is not used by the declarative sync. */
export type AutoModRule = Omit<APIAutoModerationRule, 'creator_id'>;

export type AutoModRuleBody = RESTPostAPIAutoModerationRuleJSONBody;

export type AutoModRuleUpdateBody = RESTPatchAPIAutoModerationRuleJSONBody;
