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
): { create: DesiredChannel[]; update: ChannelUpdate[]; extra: GuildChannel[] } {
  const nonCategory = live.filter((ch) => ch.type !== ChannelType.GuildCategory);
  const liveByName = new Map(nonCategory.map((ch) => [ch.name, ch]));
  const create: DesiredChannel[] = [];
  const update: ChannelUpdate[] = [];
  const matched = new Set<string>();

  for (const channel of desired) {
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
    const desiredParentId = channel.category
      ? (categoryIdByName.get(channel.category) ?? null)
      : null;
    if (desiredParentId !== null && desiredParentId !== (existing.parent_id ?? null)) {
      changes.push(`category → ${channel.category}`);
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

  // Channels created in the same sync as their category won't have a live
  // parent id yet — resolve() re-runs this after categories are created.
  const categoryIdByName = new Map<string, string>();
  for (const [name, ch] of categoryDiff.liveByName) {
    categoryIdByName.set(name, ch.id);
  }
  const channelDiff = diffChannels(desired.channels, live.channels, categoryIdByName);

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
