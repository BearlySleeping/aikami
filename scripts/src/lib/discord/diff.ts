// scripts/src/lib/discord/diff.ts
//
// Pure diff: compare structure.ts (desired) against the live guild
// (channels, roles, guild settings, and AutoMod rules as returned by the
// REST API) and produce a Plan. No I/O here — sync.ts fetches the live
// state and applies the plan; this module only decides WHAT would change,
// so it's trivial to unit test and to print without touching the network.
//
// Matching is by name (see structure.ts's "Matching" note).

import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  ForumLayoutType,
  GuildOnboardingMode,
  SortOrderType,
} from 'discord-api-types/v10';
import {
  type AutoModKeywordPreset,
  type AutoModTriggerKind,
  type DesiredAutoModAction,
  type DesiredAutoModRule,
  type DesiredCategory,
  type DesiredChannel,
  type DesiredChannelType,
  type DesiredGuild,
  type DesiredOnboarding,
  type DesiredOnboardingPrompt,
  type DesiredPermissionOverwrite,
  type DesiredRole,
  type DesiredWelcomeScreen,
  permissionsToBitfield,
} from './structure';
import type {
  AutoModAction,
  AutoModRule,
  AutoModRuleBody,
  AutoModTriggerMetadata,
  GuildChannel,
  GuildRole,
  GuildSettings,
  GuildUpdateBody,
  Onboarding,
  OnboardingPrompt,
  PermissionOverwrite,
  WelcomeScreen,
  WelcomeScreenBody,
} from './types';

export const CHANNEL_TYPE_MAP = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
  media: ChannelType.GuildMedia,
} as const satisfies Record<DesiredChannelType, ChannelType>;

// The ONLY channel-type conversion `PATCH /channels/{id}` supports is text
// ↔ announcement (both are "message channels" under the hood). Anything
// else (e.g. text → forum, text → media) is rejected by the API — but only
// AFTER other changes in the same apply have already landed, which is worse
// than failing here at plan time. Keyed `"liveType->desiredType"`.
const ALLOWED_TYPE_CONVERSIONS = new Set([
  `${ChannelType.GuildText}->${ChannelType.GuildAnnouncement}`,
  `${ChannelType.GuildAnnouncement}->${ChannelType.GuildText}`,
]);

const AUTOMOD_TRIGGER_MAP: Record<AutoModTriggerKind, AutoModerationRuleTriggerType> = {
  spam: AutoModerationRuleTriggerType.Spam,
  mentionSpam: AutoModerationRuleTriggerType.MentionSpam,
  keywordPreset: AutoModerationRuleTriggerType.KeywordPreset,
  keyword: AutoModerationRuleTriggerType.Keyword,
};

const AUTOMOD_PRESET_MAP: Record<AutoModKeywordPreset, AutoModerationRuleKeywordPresetType> = {
  profanity: AutoModerationRuleKeywordPresetType.Profanity,
  sexualContent: AutoModerationRuleKeywordPresetType.SexualContent,
  slurs: AutoModerationRuleKeywordPresetType.Slurs,
};

const FORUM_LAYOUT_MAP: Record<'list' | 'gallery', ForumLayoutType> = {
  list: ForumLayoutType.ListView,
  gallery: ForumLayoutType.GalleryView,
};

const FORUM_SORT_MAP: Record<'latestActivity' | 'creationDate', SortOrderType> = {
  latestActivity: SortOrderType.LatestActivity,
  creationDate: SortOrderType.CreationDate,
};

export type LiveState = {
  channels: GuildChannel[];
  roles: GuildRole[];
  guild: GuildSettings;
  automodRules: AutoModRule[];
  onboarding: Onboarding;
  welcomeScreen: WelcomeScreen;
};

export type ChannelUpdate = { id: string; name: string; changes: string[] };
export type RoleUpdate = { id: string; name: string; changes: string[] };
export type AutoModRuleUpdate = {
  id: string;
  name: string;
  changes: string[];
  body: AutoModRuleBody;
};
export type GuildUpdate = { changes: string[]; body: GuildUpdateBody };
export type PositionChange = { id: string; name: string; from: number; to: number };
export type WelcomeScreenUpdate = { changes: string[]; body: WelcomeScreenBody };

export type Plan = {
  guildUpdate: GuildUpdate | null;
  createCategories: DesiredCategory[];
  createChannels: DesiredChannel[];
  createRoles: DesiredRole[];
  updateChannels: ChannelUpdate[];
  updateRoles: RoleUpdate[];
  /** Live channels/roles with no match in structure.ts. Only deleted with --prune. */
  deleteChannels: { id: string; name: string }[];
  deleteRoles: { id: string; name: string }[];
  createAutomodRules: { rule: DesiredAutoModRule; body: AutoModRuleBody }[];
  updateAutomodRules: AutoModRuleUpdate[];
  deleteAutomodRules: { id: string; name: string }[];
  roleReorders: PositionChange[];
  channelReorders: PositionChange[];
  /**
   * Just change descriptions, not a body — `PUT /guilds/{id}/onboarding`
   * replaces prompts/options wholesale and each needs an `id` that either
   * reuses a live one (matched by title) or is a fresh placeholder, which
   * can only be resolved against live data at APPLY time (sync.ts's
   * buildOnboardingBody), not here.
   */
  onboardingUpdate: string[] | null;
  welcomeScreenUpdate: WelcomeScreenUpdate | null;
};

export function planIsEmpty(plan: Plan): boolean {
  return (
    plan.guildUpdate === null &&
    plan.createCategories.length === 0 &&
    plan.createChannels.length === 0 &&
    plan.createRoles.length === 0 &&
    plan.updateChannels.length === 0 &&
    plan.updateRoles.length === 0 &&
    plan.deleteChannels.length === 0 &&
    plan.deleteRoles.length === 0 &&
    plan.createAutomodRules.length === 0 &&
    plan.updateAutomodRules.length === 0 &&
    plan.deleteAutomodRules.length === 0 &&
    plan.roleReorders.length === 0 &&
    plan.channelReorders.length === 0 &&
    plan.onboardingUpdate === null &&
    plan.welcomeScreenUpdate === null
  );
}

function diffRoles(
  desired: DesiredRole[],
  live: GuildRole[],
): {
  create: DesiredRole[];
  update: RoleUpdate[];
  extra: GuildRole[];
} {
  const liveByName = new Map(live.map((r) => [r.name, r]));
  const create: DesiredRole[] = [];
  const update: RoleUpdate[] = [];
  const matched = new Set<string>();

  for (const role of desired) {
    const existing = liveByName.get(role.name);
    if (!existing) {
      create.push(role);
      continue;
    }
    matched.add(existing.id);
    const changes: string[] = [];
    if (role.color !== undefined && role.color !== existing.color) {
      changes.push(`color ${existing.color} → ${role.color}`);
    }
    if (role.hoist !== undefined && role.hoist !== existing.hoist) {
      changes.push(`hoist ${existing.hoist} → ${role.hoist}`);
    }
    if (role.mentionable !== undefined && role.mentionable !== existing.mentionable) {
      changes.push(`mentionable ${existing.mentionable} → ${role.mentionable}`);
    }
    if (role.permissions !== undefined && role.permissions !== existing.permissions) {
      changes.push(`permissions ${existing.permissions} → ${role.permissions}`);
    }
    if (changes.length > 0) {
      update.push({ id: existing.id, name: role.name, changes });
    }
  }

  // Discord auto-creates @everyone with the guild — never treat it as
  // "extra". A MANAGED role (e.g. the bot's own "AiKami Bot" role) is
  // outside declarative sync entirely — structure.ts is documented to never
  // declare one (Discord forbids editing it anyway), so it must never show
  // up as a deletion candidate either, prune or not.
  const extra = live.filter((r) => r.name !== '@everyone' && !r.managed && !matched.has(r.id));
  return { create, update, extra };
}

/**
 * Roles/channels are declared in hierarchy/display order (see structure.ts's
 * file header) rather than carrying an explicit numeric position each. This
 * reassigns the NUMERIC SLOTS a group of live, already-matched entries
 * already owns, in the order structure.ts declares them — it never invents
 * a brand-new position number or touches an entry outside the group (e.g.
 * the managed "AiKami Bot" role, or a category's sibling channels), because
 * every number it hands out is one the group already held.
 *
 * `order` accounts for the two schemes Discord uses for "position": for
 * ROLES a higher number is higher in the hierarchy, so top-first
 * declaration order wants the HIGHEST slot first ('desc'); for CHANNELS a
 * lower number is higher in the on-screen list, so top-first declaration
 * order wants the LOWEST slot first ('asc').
 */
function reassignPositions<T extends { name: string; position?: number }>(
  desiredOrder: T[],
  liveByName: Map<string, { id: string; position: number }>,
  order: 'asc' | 'desc',
): PositionChange[] {
  const matched = desiredOrder.filter((entry) => liveByName.has(entry.name));
  if (matched.length === 0) {
    return [];
  }
  const slots = matched
    .map((entry) => liveByName.get(entry.name)?.position ?? 0)
    .sort((a, b) => (order === 'desc' ? b - a : a - b));

  const changes: PositionChange[] = [];
  matched.forEach((entry, i) => {
    const live = liveByName.get(entry.name);
    if (!live) {
      return;
    }
    const want = entry.position ?? slots[i] ?? live.position;
    if (want !== live.position) {
      changes.push({ id: live.id, name: entry.name, from: live.position, to: want });
    }
  });
  return changes;
}

function diffRolePositions(desired: DesiredRole[], live: GuildRole[]): PositionChange[] {
  const liveByName = new Map(live.map((r) => [r.name, { id: r.id, position: r.position }]));
  return reassignPositions(desired, liveByName, 'desc');
}

function diffChannelPositions(
  desired: DesiredChannel[],
  live: GuildChannel[],
  categoryIdByName: Map<string, string>,
): PositionChange[] {
  const nonCategory = live.filter((ch) => ch.type !== ChannelType.GuildCategory);
  // Group desired channels by their resolved (or pending) category name so
  // siblings only ever get reassigned among themselves.
  const groups = new Map<string, DesiredChannel[]>();
  for (const channel of desired) {
    const key = channel.category ?? '__top_level__';
    const group = groups.get(key) ?? [];
    group.push(channel);
    groups.set(key, group);
  }

  const changes: PositionChange[] = [];
  for (const [categoryName, group] of groups) {
    const parentId =
      categoryName === '__top_level__' ? null : (categoryIdByName.get(categoryName) ?? null);
    const liveByName = new Map(
      nonCategory
        .filter((ch) => (ch.parent_id ?? null) === parentId)
        .map((ch) => [ch.name, { id: ch.id, position: ch.position ?? 0 }]),
    );
    changes.push(...reassignPositions(group, liveByName, 'asc'));
  }
  return changes;
}

function diffCategories(
  desired: DesiredCategory[],
  live: GuildChannel[],
): { create: DesiredCategory[]; extra: GuildChannel[]; liveByName: Map<string, GuildChannel> } {
  const categories = live.filter((ch) => ch.type === ChannelType.GuildCategory);
  const liveByName = new Map(categories.map((ch) => [ch.name, ch]));
  const desiredNames = new Set(desired.map((cat) => cat.name));
  const create = desired.filter((cat) => !liveByName.has(cat.name));
  const extra = categories.filter((cat) => !desiredNames.has(cat.name));
  return { create, extra, liveByName };
}

/**
 * Role-type overwrites only, keyed by "roleName|allow|deny" — order-independent set comparison.
 *
 * Discord overwrites come in two kinds: `type: 0` (role-scoped, what
 * structure.ts declares) and `type: 1` (member-scoped — permissions pinned
 * to one specific user). This filters to `type === 0` ON PURPOSE: a
 * member overwrite has no name to declare it by, so structure.ts has no way
 * to represent one and this diff can never plan a change for it. That means
 * a member overwrite is invisible here FOREVER — it never shows up as
 * drift, is never reconciled, and a sync never touches it (`sync.ts` only
 * ever sends the role-type overwrites this function reads). `discord
 * audit`'s table output prints any live member overwrites it finds so the
 * drift is at least visible somewhere, even though nothing here acts on it.
 */
function overwriteKeySet(
  overwrites: DesiredPermissionOverwrite[] | undefined,
  live: PermissionOverwrite[] | undefined,
  roleNameById: Map<string, string>,
): { desired: Set<string>; live: Set<string> } | undefined {
  if (!overwrites) {
    return undefined;
  }
  const desired = new Set(
    overwrites.map(
      (o) => `${o.role}|${permissionsToBitfield(o.allow)}|${permissionsToBitfield(o.deny)}`,
    ),
  );
  const liveSet = new Set(
    (live ?? [])
      .filter((o) => o.type === 0)
      .map((o) => `${roleNameById.get(o.id) ?? o.id}|${o.allow}|${o.deny}`),
  );
  return { desired, live: liveSet };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}

/** `"name|moderated|emojiName"` set comparison for forum tags — id-agnostic, order-independent. */
function forumTagKeySet(
  desired: { name: string; moderated?: boolean; emojiName?: string }[],
): Set<string> {
  return new Set(desired.map((t) => `${t.name}|${Boolean(t.moderated)}|${t.emojiName ?? ''}`));
}

function liveForumTagKeySet(live: GuildChannel['available_tags']): Set<string> {
  return new Set((live ?? []).map((t) => `${t.name}|${t.moderated}|${t.emoji_name ?? ''}`));
}

/** Diffs `channel.forum` against the live channel's forum-only fields; only meaningful for forum/media channels. */
function diffForumConfig(channel: DesiredChannel, existing: GuildChannel, changes: string[]): void {
  const forum = channel.forum;
  if (!forum) {
    return;
  }
  if (!setsEqual(forumTagKeySet(forum.tags), liveForumTagKeySet(existing.available_tags))) {
    changes.push('forum tags changed');
  }
  const desiredReaction = forum.defaultReaction ?? null;
  const liveReaction = existing.default_reaction_emoji?.emoji_name ?? null;
  if (desiredReaction !== liveReaction) {
    changes.push(`forum default reaction ${liveReaction ?? 'none'} → ${desiredReaction ?? 'none'}`);
  }
  const desiredLayout = forum.defaultLayout
    ? FORUM_LAYOUT_MAP[forum.defaultLayout]
    : ForumLayoutType.NotSet;
  if (desiredLayout !== (existing.default_forum_layout ?? ForumLayoutType.NotSet)) {
    changes.push(`forum layout ${existing.default_forum_layout ?? 0} → ${desiredLayout}`);
  }
  const desiredSort = forum.defaultSortOrder
    ? FORUM_SORT_MAP[forum.defaultSortOrder]
    : SortOrderType.LatestActivity;
  if (desiredSort !== (existing.default_sort_order ?? SortOrderType.LatestActivity)) {
    changes.push(`forum sort order ${existing.default_sort_order ?? 0} → ${desiredSort}`);
  }
}

function diffChannels(
  desired: DesiredChannel[],
  live: GuildChannel[],
  categoryIdByName: Map<string, string>,
  desiredCategoryNames: Set<string>,
  roleNameById: Map<string, string>,
): { create: DesiredChannel[]; update: ChannelUpdate[]; extra: GuildChannel[] } {
  const nonCategory = live.filter((ch) => ch.type !== ChannelType.GuildCategory);
  const liveByName = new Map(nonCategory.map((ch) => [ch.name, ch]));
  const create: DesiredChannel[] = [];
  const update: ChannelUpdate[] = [];
  const matched = new Set<string>();

  for (const channel of desired) {
    // 🔴 Resolve + VALIDATE the category reference before planning anything.
    // The old `categoryIdByName.get(...) ?? null` fallback silently treated
    // an invalid category name as "move to top level" — a typo in
    // structure.ts would quietly yank every channel out of its category.
    // Validation is against structure.categories (the declaration), so
    // categories being created during THIS same sync (declared but not live
    // yet) are valid references too.
    let desiredParentId: string | null;
    let pendingCategory = false;
    if (channel.category) {
      const liveId = categoryIdByName.get(channel.category);
      if (liveId !== undefined) {
        desiredParentId = liveId;
      } else if (desiredCategoryNames.has(channel.category)) {
        // Declared but not live yet — created earlier in this same sync, so
        // the parent id is applied from the post-create map at apply time.
        desiredParentId = null;
        pendingCategory = true;
      } else {
        throw new Error(
          `Invalid category reference: channel "${channel.name}" declares category ` +
            `"${channel.category}", which is not listed in structure.categories.`,
        );
      }
    } else {
      desiredParentId = null; // top level
    }

    const existing = liveByName.get(channel.name);
    if (!existing) {
      create.push(channel);
      continue;
    }
    matched.add(existing.id);
    const changes: string[] = [];
    const desiredType = CHANNEL_TYPE_MAP[channel.type];
    if (desiredType !== existing.type) {
      // 🔴 Fail at PLAN time, not mid-apply. `PATCH /channels/{id}` only
      // supports text ↔ announcement — anything else (e.g. text → forum)
      // is rejected by Discord's API, but only after earlier changes in the
      // same `sync --apply` run have already landed. See structure.ts fact 2.
      const key = `${existing.type}->${desiredType}`;
      if (!ALLOWED_TYPE_CONVERSIONS.has(key)) {
        throw new Error(
          `Channel "${channel.name}" cannot change type ${existing.type} → ${desiredType} via ` +
            'PATCH — Discord only allows text ↔ announcement conversion. Delete and recreate it ' +
            '(sync --apply --prune to delete, then a normal apply to create) instead of declaring ' +
            'the type change here.',
        );
      }
      changes.push(`type ${existing.type} → ${desiredType}`);
    }
    const currentParentId = existing.parent_id ?? null;
    if (channel.category) {
      if (pendingCategory) {
        // The category cannot exist live yet, so whatever the channel's
        // current parent is, a move into the new category is needed.
        changes.push(`category → ${channel.category} (created this sync)`);
      } else if (desiredParentId !== currentParentId) {
        changes.push(`category → ${channel.category}`);
      }
    } else if (currentParentId !== null) {
      // Desired state is top level but the channel is currently categorized
      // — plan the move UP. Applied with parent_id: null (omitting parent_id
      // would leave the channel where it is — see ChannelUpdateBody).
      changes.push('category → top level');
    }
    // For a forum/media channel, `forum.postGuidelines` IS the topic field
    // — declaring both would be ambiguous, so forum config wins. Voice/stage
    // channels have NO topic field at all — Discord rejects any string sent
    // as one with a generic `CHANNEL_TOPIC_INVALID` (confirmed live: even
    // plain "test" is rejected), so `channel.topic` is never diffed or sent
    // for them even if structure.ts declares one for documentation.
    const effectiveTopic = channel.forum?.postGuidelines ?? channel.topic;
    const supportsTopic = channel.type !== 'voice' && channel.type !== 'stage';
    if (
      supportsTopic &&
      effectiveTopic !== undefined &&
      effectiveTopic !== (existing.topic ?? undefined)
    ) {
      changes.push(`topic → ${JSON.stringify(effectiveTopic)}`);
    }
    if (channel.nsfw !== undefined && channel.nsfw !== Boolean(existing.nsfw)) {
      changes.push(`nsfw ${Boolean(existing.nsfw)} → ${channel.nsfw}`);
    }
    if (
      channel.slowmodeSeconds !== undefined &&
      channel.slowmodeSeconds !== (existing.rate_limit_per_user ?? 0)
    ) {
      changes.push(`slowmode ${existing.rate_limit_per_user ?? 0}s → ${channel.slowmodeSeconds}s`);
    }
    diffForumConfig(channel, existing, changes);
    const overwriteSets = overwriteKeySet(
      channel.permissionOverwrites,
      existing.permission_overwrites,
      roleNameById,
    );
    if (overwriteSets && !setsEqual(overwriteSets.desired, overwriteSets.live)) {
      changes.push('permissions changed');
    }
    if (changes.length > 0) {
      update.push({ id: existing.id, name: channel.name, changes });
    }
  }

  const extra = nonCategory.filter((ch) => !matched.has(ch.id));
  return { create, update, extra };
}

function buildAutomodBody(
  rule: DesiredAutoModRule,
  roleIdByName: Map<string, string>,
  channelIdByName: Map<string, string>,
  desiredRoleNames: Set<string>,
): AutoModRuleBody {
  const trigger_metadata: AutoModTriggerMetadata = {};
  if (rule.mentionTotalLimit !== undefined) {
    trigger_metadata.mention_total_limit = rule.mentionTotalLimit;
  }
  if (rule.mentionRaidProtection !== undefined) {
    trigger_metadata.mention_raid_protection_enabled = rule.mentionRaidProtection;
  }
  if (rule.presets) {
    trigger_metadata.presets = rule.presets.map((p) => AUTOMOD_PRESET_MAP[p]);
  }
  if (rule.keywordFilter) {
    trigger_metadata.keyword_filter = rule.keywordFilter;
  }
  if (rule.regexPatterns) {
    trigger_metadata.regex_patterns = rule.regexPatterns;
  }

  const actions: AutoModAction[] = rule.actions.map((action) =>
    resolveAutomodAction(action, channelIdByName),
  );

  const exempt_roles = (rule.exemptRoles ?? []).map((name) => {
    const id = roleIdByName.get(name);
    if (!id) {
      if (desiredRoleNames.has(name)) {
        throw new Error(
          `AutoMod rule "${rule.name}" exempts role "${name}", which is declared in ` +
            'structure.roles but must exist live first.',
        );
      }
      throw new Error(
        `AutoMod rule "${rule.name}" exempts role "${name}", which is not declared in structure.roles.`,
      );
    }
    return id;
  });
  const exempt_channels = (rule.exemptChannels ?? []).map((name) => {
    const id = channelIdByName.get(name);
    if (!id) {
      throw new Error(
        `AutoMod rule "${rule.name}" exempts channel "${name}", which doesn't exist live.`,
      );
    }
    return id;
  });

  return {
    name: rule.name,
    event_type: AutoModerationRuleEventType.MessageSend,
    trigger_type: AUTOMOD_TRIGGER_MAP[rule.trigger],
    trigger_metadata: Object.keys(trigger_metadata).length > 0 ? trigger_metadata : undefined,
    actions,
    enabled: rule.enabled ?? true,
    exempt_roles,
    exempt_channels,
  };
}

function resolveAutomodAction(
  action: DesiredAutoModAction,
  channelIdByName: Map<string, string>,
): AutoModAction {
  switch (action.type) {
    case 'blockMessage':
      return {
        type: AutoModerationActionType.BlockMessage,
        metadata: action.customMessage ? { custom_message: action.customMessage } : undefined,
      };
    case 'alert': {
      const channelId = channelIdByName.get(action.channel);
      if (!channelId) {
        throw new Error(
          `AutoMod alert action references channel "${action.channel}", which doesn't exist live.`,
        );
      }
      return {
        type: AutoModerationActionType.SendAlertMessage,
        metadata: { channel_id: channelId },
      };
    }
    case 'timeout':
      return {
        type: AutoModerationActionType.Timeout,
        metadata: { duration_seconds: action.durationSeconds },
      };
  }
}

/** JSON-stable comparison after sorting every array field, so declaration order never causes a phantom diff. */
function normalizedJson(value: unknown): string {
  const sortArrays = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return [...v]
        .map(sortArrays)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, sortArrays(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sortArrays(value));
}

/**
 * Discord always echoes `keyword_filter`/`presets`/`regex_patterns`/
 * `allow_list` back as `[]` on a live rule even when they were never sent —
 * comparing our desired body (which OMITS a field entirely when we don't
 * declare it) against that live shape would show a phantom "trigger
 * metadata changed" on every single diff/sync forever. Filling the same
 * defaults into BOTH sides before comparing (never into what's actually
 * sent to the API — only here) makes "we didn't declare it" and "Discord
 * defaulted it to empty" compare as equal.
 */
function canonicalizeTriggerMetadata(
  metadata: AutoModTriggerMetadata | undefined,
): AutoModTriggerMetadata {
  return {
    keyword_filter: [],
    presets: [],
    regex_patterns: [],
    allow_list: [],
    ...metadata,
  };
}

/**
 * Same phantom-diff problem as canonicalizeTriggerMetadata above, one level
 * down: Discord always echoes an action's `metadata` back as `{}` even when
 * we sent no `metadata` key at all (confirmed live — a bare `blockMessage`
 * action compares `{type:1}` desired vs `{type:1,metadata:{}}` live
 * forever). Only used for comparison, never for what's actually sent.
 */
function canonicalizeActions(actions: AutoModAction[]): AutoModAction[] {
  return actions.map((action) => ({ ...action, metadata: action.metadata ?? {} }));
}

function diffAutomod(
  desired: DesiredAutoModRule[],
  live: AutoModRule[],
  roleIdByName: Map<string, string>,
  channelIdByName: Map<string, string>,
  desiredRoleNames: Set<string>,
): {
  create: { rule: DesiredAutoModRule; body: AutoModRuleBody }[];
  update: AutoModRuleUpdate[];
  extra: { id: string; name: string }[];
} {
  const liveByName = new Map(live.map((r) => [r.name, r]));
  const create: { rule: DesiredAutoModRule; body: AutoModRuleBody }[] = [];
  const update: AutoModRuleUpdate[] = [];
  const matched = new Set<string>();

  for (const rule of desired) {
    const body = buildAutomodBody(rule, roleIdByName, channelIdByName, desiredRoleNames);
    const existing = liveByName.get(rule.name);
    if (!existing) {
      create.push({ rule, body });
      continue;
    }
    matched.add(existing.id);
    const changes: string[] = [];
    if (body.trigger_type !== existing.trigger_type) {
      changes.push(`trigger ${existing.trigger_type} → ${body.trigger_type}`);
    }
    if (
      normalizedJson(canonicalizeTriggerMetadata(body.trigger_metadata)) !==
      normalizedJson(canonicalizeTriggerMetadata(existing.trigger_metadata))
    ) {
      changes.push('trigger metadata changed');
    }
    if (
      normalizedJson(canonicalizeActions(body.actions)) !==
      normalizedJson(canonicalizeActions(existing.actions))
    ) {
      changes.push('actions changed');
    }
    if (normalizedJson(body.exempt_roles ?? []) !== normalizedJson(existing.exempt_roles ?? [])) {
      changes.push('exempt roles changed');
    }
    if (
      normalizedJson(body.exempt_channels ?? []) !== normalizedJson(existing.exempt_channels ?? [])
    ) {
      changes.push('exempt channels changed');
    }
    if ((body.enabled ?? false) !== existing.enabled) {
      changes.push(`enabled ${existing.enabled} → ${body.enabled ?? false}`);
    }
    if (changes.length > 0) {
      update.push({ id: existing.id, name: rule.name, changes, body });
    }
  }

  const extra = live.filter((r) => !matched.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
  return { create, update, extra };
}

const GUILD_LEVEL_FIELDS: {
  key: keyof DesiredGuild;
  liveKey: keyof GuildSettings;
  label: string;
}[] = [
  { key: 'verificationLevel', liveKey: 'verification_level', label: 'verificationLevel' },
  {
    key: 'explicitContentFilter',
    liveKey: 'explicit_content_filter',
    label: 'explicitContentFilter',
  },
  { key: 'description', liveKey: 'description', label: 'description' },
];

const GUILD_CHANNEL_FIELDS: {
  key: keyof DesiredGuild;
  liveKey: keyof GuildSettings;
  label: string;
}[] = [
  { key: 'rulesChannel', liveKey: 'rules_channel_id', label: 'rulesChannel' },
  {
    key: 'publicUpdatesChannel',
    liveKey: 'public_updates_channel_id',
    label: 'publicUpdatesChannel',
  },
  { key: 'safetyAlertsChannel', liveKey: 'safety_alerts_channel_id', label: 'safetyAlertsChannel' },
  { key: 'systemChannel', liveKey: 'system_channel_id', label: 'systemChannel' },
];

function diffGuild(
  desired: DesiredGuild | undefined,
  live: GuildSettings,
  channelIdByName: Map<string, string>,
): GuildUpdate | null {
  if (!desired) {
    return null;
  }
  const changes: string[] = [];
  const body: GuildUpdateBody = {};

  for (const field of GUILD_LEVEL_FIELDS) {
    const desiredValue = desired[field.key];
    if (desiredValue === undefined) {
      continue;
    }
    const liveValue = live[field.liveKey];
    if (desiredValue !== liveValue) {
      changes.push(`${field.label} ${String(liveValue)} → ${String(desiredValue)}`);
      (body as Record<string, unknown>)[field.liveKey] = desiredValue;
    }
  }

  for (const field of GUILD_CHANNEL_FIELDS) {
    const channelName = desired[field.key];
    if (channelName === undefined || typeof channelName !== 'string') {
      continue;
    }
    const channelId = channelIdByName.get(channelName);
    if (!channelId) {
      throw new Error(
        `structure.guild.${field.key} references channel "${channelName}", which doesn't exist live.`,
      );
    }
    const liveValue = live[field.liveKey] ?? null;
    if (channelId !== liveValue) {
      changes.push(`${field.label} → ${channelName}`);
      (body as Record<string, unknown>)[field.liveKey] = channelId;
    }
  }

  return changes.length > 0 ? { changes, body } : null;
}

const ONBOARDING_MODE_MAP: Record<'default' | 'advanced', GuildOnboardingMode> = {
  default: GuildOnboardingMode.OnboardingDefault,
  advanced: GuildOnboardingMode.OnboardingAdvanced,
};

function resolveIds(
  names: string[] | undefined,
  idByName: Map<string, string>,
  context: string,
  kind: 'channel' | 'role',
): string[] {
  return (names ?? []).map((name) => {
    const id = idByName.get(name);
    if (!id) {
      throw new Error(`${context} references ${kind} "${name}", which doesn't exist live.`);
    }
    return id;
  });
}

/** A prompt's structural fingerprint, WITHOUT ids — comparison only, never sent to the API. */
function normalizedPrompt(prompt: {
  title: string;
  single_select: boolean;
  required: boolean;
  in_onboarding: boolean;
  options: {
    title: string;
    description: string | null;
    channel_ids: readonly string[];
    role_ids: readonly string[];
    emoji_name: string | null;
  }[];
}): string {
  return normalizedJson({
    title: prompt.title,
    single_select: prompt.single_select,
    required: prompt.required,
    in_onboarding: prompt.in_onboarding,
    options: [...prompt.options]
      .map((o) => ({
        title: o.title,
        description: o.description ?? '',
        channel_ids: [...o.channel_ids].sort(),
        role_ids: [...o.role_ids].sort(),
        emoji_name: o.emoji_name ?? '',
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  });
}

/**
 * The live GET response nests an option's emoji under `emoji: { name, id }`
 * (CONTEXT fact 4's other half — this is the shape the PUT body must NOT
 * use, but it IS what reading a live rule back gives you). Converts to the
 * same flat `emoji_name` shape normalizedPrompt/desiredToComparablePrompt
 * use so both sides compare like-for-like.
 */
function liveToComparablePrompt(prompt: OnboardingPrompt) {
  return {
    title: prompt.title,
    single_select: prompt.single_select,
    required: prompt.required,
    in_onboarding: prompt.in_onboarding,
    options: prompt.options.map((option) => ({
      title: option.title,
      description: option.description,
      channel_ids: option.channel_ids,
      role_ids: option.role_ids,
      emoji_name: option.emoji?.name ?? null,
    })),
  };
}

function desiredToComparablePrompt(
  prompt: DesiredOnboardingPrompt,
  channelIdByName: Map<string, string>,
  roleIdByName: Map<string, string>,
) {
  return {
    title: prompt.title,
    single_select: Boolean(prompt.singleSelect),
    required: Boolean(prompt.required),
    in_onboarding: prompt.inOnboarding ?? true,
    options: prompt.options.map((option) => ({
      title: option.title,
      description: option.description ?? null,
      channel_ids: resolveIds(
        option.channels,
        channelIdByName,
        `onboarding prompt "${prompt.title}" option "${option.title}"`,
        'channel',
      ),
      role_ids: resolveIds(
        option.roles,
        roleIdByName,
        `onboarding prompt "${prompt.title}" option "${option.title}"`,
        'role',
      ),
      emoji_name: option.emojiName,
    })),
  };
}

/**
 * Coarse-grained on purpose: `PUT /guilds/{id}/onboarding` replaces the
 * whole config in one call regardless of what changed, so there's no
 * per-field PATCH to target — a human reading "prompts changed" already
 * knows to look at structure.ts's onboarding block, the single source of
 * truth, rather than needing a field-by-field diff of a config that gets
 * fully re-sent either way.
 */
function diffOnboarding(
  desired: DesiredOnboarding | undefined,
  live: Onboarding,
  channelIdByName: Map<string, string>,
  roleIdByName: Map<string, string>,
): string[] | null {
  if (!desired) {
    return null;
  }
  const changes: string[] = [];

  if (desired.enabled !== live.enabled) {
    changes.push(`enabled ${live.enabled} → ${desired.enabled}`);
  }
  const desiredMode = ONBOARDING_MODE_MAP[desired.mode];
  if (desiredMode !== live.mode) {
    changes.push(`mode ${live.mode} → ${desiredMode}`);
  }
  const desiredDefaultIds = resolveIds(
    desired.defaultChannels,
    channelIdByName,
    'onboarding.defaultChannels',
    'channel',
  );
  if (!setsEqual(new Set(desiredDefaultIds), new Set(live.default_channel_ids))) {
    changes.push('defaultChannels changed');
  }

  const desiredPrompts = desired.prompts.map((p) =>
    desiredToComparablePrompt(p, channelIdByName, roleIdByName),
  );
  const desiredTitles = new Set(desiredPrompts.map((p) => p.title));
  const liveTitles = new Set(live.prompts.map((p: OnboardingPrompt) => p.title));
  if (!setsEqual(desiredTitles, liveTitles)) {
    changes.push('prompts added/removed');
  } else {
    const liveByTitle = new Map(live.prompts.map((p: OnboardingPrompt) => [p.title, p]));
    for (const prompt of desiredPrompts) {
      const liveMatch = liveByTitle.get(prompt.title);
      if (
        liveMatch &&
        normalizedPrompt(prompt) !== normalizedPrompt(liveToComparablePrompt(liveMatch))
      ) {
        changes.push(`prompt "${prompt.title}" changed`);
      }
    }
  }

  return changes.length > 0 ? changes : null;
}

/**
 * Unlike onboarding, welcome-screen channel ORDER is meaningful (it's a
 * displayed list) — comparison here deliberately does NOT go through
 * normalizedJson (which sorts arrays for order-independent comparison).
 */
function diffWelcomeScreen(
  desired: DesiredWelcomeScreen | undefined,
  live: WelcomeScreen,
  channelIdByName: Map<string, string>,
): WelcomeScreenUpdate | null {
  if (!desired) {
    return null;
  }
  const desiredChannels = desired.channels.map((ch) => {
    const channelId = channelIdByName.get(ch.channel);
    if (!channelId) {
      throw new Error(
        `welcomeScreen references channel "${ch.channel}", which doesn't exist live.`,
      );
    }
    return {
      channel_id: channelId,
      description: ch.description,
      emoji_id: null,
      emoji_name: ch.emojiName ?? null,
    };
  });
  const body: WelcomeScreenBody = {
    enabled: true,
    description: desired.description,
    welcome_channels: desiredChannels,
  };

  const fingerprint = (
    channels: { channel_id: string; description: string; emoji_name: string | null }[],
  ) => JSON.stringify(channels.map((c) => [c.channel_id, c.description, c.emoji_name ?? '']));

  const changes: string[] = [];
  if ((live.description ?? '') !== desired.description) {
    changes.push(
      `description ${JSON.stringify(live.description)} → ${JSON.stringify(desired.description)}`,
    );
  }
  if (fingerprint(desiredChannels) !== fingerprint(live.welcome_channels ?? [])) {
    changes.push('welcome channels changed');
  }

  return changes.length > 0 ? { changes, body } : null;
}

/** Compare `desired` (structure.ts) against `live` (fetched from Discord) and produce a Plan. */
export function computePlan(
  desired: {
    guild?: DesiredGuild;
    roles: DesiredRole[];
    categories: DesiredCategory[];
    channels: DesiredChannel[];
    automod?: DesiredAutoModRule[];
    onboarding?: DesiredOnboarding;
    welcomeScreen?: DesiredWelcomeScreen;
  },
  live: LiveState,
): Plan {
  const roleDiff = diffRoles(desired.roles, live.roles);
  const categoryDiff = diffCategories(desired.categories, live.channels);

  // Live categories by name. Channels pointing at a category that is only
  // DECLARED (created during this same sync) resolve via
  // desiredCategoryNames below — the parent id itself is applied at apply
  // time from the post-create map (sync.ts adds each created category to its
  // categoryIdByName before creating/updating channels).
  const categoryIdByName = new Map<string, string>();
  for (const [name, ch] of categoryDiff.liveByName) {
    categoryIdByName.set(name, ch.id);
  }
  const desiredCategoryNames = new Set(desired.categories.map((cat) => cat.name));
  // @everyone's role id always equals the guild id, and live.roles always
  // includes it — so this map alone resolves permissionOverwrites'
  // `role: '@everyone'` too, no separate guildId parameter needed here.
  const roleNameById = new Map(live.roles.map((r) => [r.id, r.name]));
  const roleIdByName = new Map(live.roles.map((r) => [r.name, r.id]));
  const channelIdByName = new Map(
    live.channels
      .filter((ch) => ch.type !== ChannelType.GuildCategory)
      .map((ch) => [ch.name, ch.id]),
  );

  const channelDiff = diffChannels(
    desired.channels,
    live.channels,
    categoryIdByName,
    desiredCategoryNames,
    roleNameById,
  );
  const automodDiff =
    desired.automod === undefined
      ? { create: [], update: [], extra: [] }
      : diffAutomod(
          desired.automod,
          live.automodRules,
          roleIdByName,
          channelIdByName,
          new Set(desired.roles.map((role) => role.name)),
        );
  const guildUpdate = diffGuild(desired.guild, live.guild, channelIdByName);
  const onboardingUpdate = diffOnboarding(
    desired.onboarding,
    live.onboarding,
    channelIdByName,
    roleIdByName,
  );
  const welcomeScreenUpdate = diffWelcomeScreen(
    desired.welcomeScreen,
    live.welcomeScreen,
    channelIdByName,
  );

  return {
    guildUpdate,
    onboardingUpdate,
    welcomeScreenUpdate,
    createCategories: categoryDiff.create,
    createChannels: channelDiff.create,
    createRoles: roleDiff.create,
    updateChannels: channelDiff.update,
    updateRoles: roleDiff.update,
    deleteChannels: [...categoryDiff.extra, ...channelDiff.extra].map((ch) => ({
      id: ch.id,
      name: ch.name,
    })),
    deleteRoles: roleDiff.extra.map((r) => ({ id: r.id, name: r.name })),
    createAutomodRules: automodDiff.create,
    updateAutomodRules: automodDiff.update,
    deleteAutomodRules: automodDiff.extra,
    roleReorders: diffRolePositions(desired.roles, live.roles),
    channelReorders: diffChannelPositions(desired.channels, live.channels, categoryIdByName),
  };
}
