// scripts/src/lib/discord/diff.ts
//
// Pure diff: compare structure.ts (desired) against the live guild
// (channels + roles as returned by the REST API) and produce a Plan.
// No I/O here — sync.ts fetches the live state and applies the plan; this
// module only decides WHAT would change, so it's trivial to unit test and
// to print without touching the network.
//
// Matching is by name (see structure.ts's "Matching" note).

import { ChannelType } from 'discord-api-types/v10';
import type { DesiredCategory, DesiredChannel, DesiredChannelType, DesiredRole } from './structure';
import type { GuildChannel, GuildRole } from './types';

export const CHANNEL_TYPE_MAP: Record<DesiredChannelType, ChannelType> = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
};

export type LiveState = { channels: GuildChannel[]; roles: GuildRole[] };

export type ChannelUpdate = { id: string; name: string; changes: string[] };
export type RoleUpdate = { id: string; name: string; changes: string[] };

export type Plan = {
  createCategories: DesiredCategory[];
  createChannels: DesiredChannel[];
  createRoles: DesiredRole[];
  updateChannels: ChannelUpdate[];
  updateRoles: RoleUpdate[];
  /** Live channels/roles with no match in structure.ts. Only deleted with --prune. */
  deleteChannels: { id: string; name: string }[];
  deleteRoles: { id: string; name: string }[];
};

export function planIsEmpty(plan: Plan): boolean {
  return (
    plan.createCategories.length === 0 &&
    plan.createChannels.length === 0 &&
    plan.createRoles.length === 0 &&
    plan.updateChannels.length === 0 &&
    plan.updateRoles.length === 0 &&
    plan.deleteChannels.length === 0 &&
    plan.deleteRoles.length === 0
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

  // Discord auto-creates @everyone with the guild — never treat it as "extra".
  const extra = live.filter((r) => r.name !== '@everyone' && !matched.has(r.id));
  return { create, update, extra };
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

function diffChannels(
  desired: DesiredChannel[],
  live: GuildChannel[],
  categoryIdByName: Map<string, string>,
  desiredCategoryNames: Set<string>,
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
    if (CHANNEL_TYPE_MAP[channel.type] !== existing.type) {
      changes.push(`type ${existing.type} → ${CHANNEL_TYPE_MAP[channel.type]}`);
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
    if (channel.topic !== undefined && channel.topic !== (existing.topic ?? undefined)) {
      changes.push(`topic → ${JSON.stringify(channel.topic)}`);
    }
    if (channel.nsfw !== undefined && channel.nsfw !== Boolean(existing.nsfw)) {
      changes.push(`nsfw ${Boolean(existing.nsfw)} → ${channel.nsfw}`);
    }
    if (changes.length > 0) {
      update.push({ id: existing.id, name: channel.name, changes });
    }
  }

  const extra = nonCategory.filter((ch) => !matched.has(ch.id));
  return { create, update, extra };
}

/** Compare `desired` (structure.ts) against `live` (fetched from Discord) and produce a Plan. */
export function computePlan(
  desired: { roles: DesiredRole[]; categories: DesiredCategory[]; channels: DesiredChannel[] },
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
  const channelDiff = diffChannels(
    desired.channels,
    live.channels,
    categoryIdByName,
    desiredCategoryNames,
  );

  return {
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
  };
}
