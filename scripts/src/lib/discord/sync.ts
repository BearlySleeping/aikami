// scripts/src/lib/discord/sync.ts
//
// Reconcile the live Discord guild against structure.ts (the declarative
// desired state). Two ways in:
//   runSync(mode, { apply: false })  → "diff": fetch + print the plan, no writes
//   runSync(mode, { apply: true })   → fetch, print the plan, THEN apply it
//
// Safety:
//   - apply only ever CREATES or UPDATES. Deletions are always computed and
//     shown, but never applied unless `prune: true` is also passed. This
//     covers channels, categories, roles, AND AutoMod rules.
//   - if structure.ts is completely empty (nothing declared yet), apply
//     refuses to run at all — an empty desired state is "not configured",
//     not "delete everything", so this can't be used to accidentally wipe
//     a real server by running sync before structure.ts is filled in.
//   - --prune additionally refuses if it would delete a majority of the
//     live channels/roles in one shot; that's almost always a name typo or
//     a stale structure.ts, not intent.

import { ChannelType } from 'discord-api-types/v10';
import { c, error, log, ok, warn } from '../cli_utils';
import {
  createAutoModRule,
  deleteAutoModRule,
  listAutoModRules,
  updateAutoModRule,
} from './automod';
import { createChannel, deleteChannel, listChannels, updateChannel } from './channels';
import { initDiscordClient } from './client';
import type { Plan } from './diff';
import { CHANNEL_TYPE_MAP, computePlan, planIsEmpty } from './diff';
import { getGuild, updateGuild } from './guild';
import { updateChannelPositions, updateRolePositions } from './positions';
import { createRole, deleteRole, listRoles, updateRole } from './roles';
import {
  type DesiredAutoModRule,
  type DesiredChannel,
  type DesiredPermissionOverwrite,
  permissionsToBitfield,
  structure,
} from './structure';
import type {
  AutoModRuleBody,
  ChannelUpdateBody,
  GuildChannel,
  PermissionOverwrite,
} from './types';

/**
 * Resolve declared overwrites (by role name) to the {id, type, allow, deny}
 * shape Discord's channel endpoints expect. Throws on an unknown role name
 * — same fail-loud rule diffChannels already applies to category refs,
 * rather than silently dropping a typo'd overwrite.
 */
function resolvePermissionOverwrites(
  overwrites: DesiredPermissionOverwrite[],
  roleIdByName: Map<string, string>,
): PermissionOverwrite[] {
  return overwrites.map((o) => {
    const id = roleIdByName.get(o.role);
    if (!id) {
      throw new Error(
        `permissionOverwrites references role "${o.role}", which is not declared in structure.roles.`,
      );
    }
    return {
      id,
      type: 0,
      allow: permissionsToBitfield(o.allow),
      deny: permissionsToBitfield(o.deny),
    };
  });
}

const FORUM_LAYOUT_TO_API: Record<'list' | 'gallery', number> = { list: 1, gallery: 2 };
const FORUM_SORT_TO_API: Record<'latestActivity' | 'creationDate', number> = {
  latestActivity: 0,
  creationDate: 1,
};

/**
 * Builds the forum-specific fields of a channel create/update body.
 * Existing tags keep their live `id` (matched by name) — Discord treats a
 * tag object with no `id` as brand-new, so re-sending the create shape on
 * every sync would duplicate every tag every time.
 */
function buildForumFields(
  channel: DesiredChannel,
  liveTagsByName: Map<string, { id: string }>,
): Pick<
  ChannelUpdateBody,
  | 'topic'
  | 'available_tags'
  | 'default_reaction_emoji'
  | 'default_forum_layout'
  | 'default_sort_order'
> {
  const forum = channel.forum;
  if (!forum) {
    // Voice/stage channels have NO topic field — Discord rejects any
    // string sent as one (see diff.ts's `supportsTopic` comment), so it's
    // never included in their create/update body even if declared.
    const supportsTopic = channel.type !== 'voice' && channel.type !== 'stage';
    return { topic: supportsTopic ? channel.topic : undefined };
  }
  return {
    topic: forum.postGuidelines ?? channel.topic,
    available_tags: forum.tags.map((tag) => ({
      ...(liveTagsByName.has(tag.name) ? { id: liveTagsByName.get(tag.name)?.id } : {}),
      name: tag.name,
      moderated: Boolean(tag.moderated),
      emoji_id: null,
      emoji_name: tag.emojiName ?? null,
    })),
    default_reaction_emoji: forum.defaultReaction
      ? { emoji_id: null, emoji_name: forum.defaultReaction }
      : null,
    default_forum_layout: forum.defaultLayout ? FORUM_LAYOUT_TO_API[forum.defaultLayout] : 0,
    default_sort_order: forum.defaultSortOrder ? FORUM_SORT_TO_API[forum.defaultSortOrder] : 0,
  };
}

export type SyncOptions = { apply: boolean; prune: boolean };

const resolveAutomodExemptRoles = (options: {
  rule: DesiredAutoModRule;
  body: AutoModRuleBody;
  roleIdByName: Map<string, string>;
}): AutoModRuleBody => ({
  ...options.body,
  exempt_roles: (options.rule.exemptRoles ?? []).map((name) => {
    const roleId = options.roleIdByName.get(name);
    if (!roleId) {
      throw new Error(`AutoMod rule "${options.rule.name}" exempts missing live role "${name}".`);
    }
    return roleId;
  }),
});

function printPlan(plan: Plan): void {
  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) {
      return;
    }
    console.log(`\n${c.bold}${title}${c.reset}`);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  };

  if (plan.guildUpdate) {
    section(
      'Update guild settings',
      plan.guildUpdate.changes.map((change) => `${c.cyan}~${c.reset} ${change}`),
    );
  }
  section(
    'Create roles',
    plan.createRoles.map((r) => `${c.green}+${c.reset} ${r.name}`),
  );
  section(
    'Create categories',
    plan.createCategories.map((cat) => `${c.green}+${c.reset} ${cat.name}`),
  );
  section(
    'Create channels',
    plan.createChannels.map(
      (ch) =>
        `${c.green}+${c.reset} ${ch.name} (${ch.type}${ch.category ? ` in ${ch.category}` : ''})`,
    ),
  );
  section(
    'Create AutoMod rules',
    plan.createAutomodRules.map((r) => `${c.green}+${c.reset} ${r.rule.name} (${r.rule.trigger})`),
  );
  section(
    'Update roles',
    plan.updateRoles.map((r) => `${c.cyan}~${c.reset} ${r.name}: ${r.changes.join(', ')}`),
  );
  section(
    'Update channels',
    plan.updateChannels.map((ch) => `${c.cyan}~${c.reset} ${ch.name}: ${ch.changes.join(', ')}`),
  );
  section(
    'Update AutoMod rules',
    plan.updateAutomodRules.map((r) => `${c.cyan}~${c.reset} ${r.name}: ${r.changes.join(', ')}`),
  );
  section(
    'Reorder roles',
    plan.roleReorders.map((r) => `${c.cyan}~${c.reset} ${r.name}: position ${r.from} → ${r.to}`),
  );
  section(
    'Reorder channels',
    plan.channelReorders.map(
      (ch) => `${c.cyan}~${c.reset} ${ch.name}: position ${ch.from} → ${ch.to}`,
    ),
  );
  section(
    'Delete channels/categories (not in structure.ts — only applied with --prune)',
    plan.deleteChannels.map((ch) => `${c.red}-${c.reset} ${ch.name}`),
  );
  section(
    'Delete roles (not in structure.ts — only applied with --prune)',
    plan.deleteRoles.map((r) => `${c.red}-${c.reset} ${r.name}`),
  );
  section(
    'Delete AutoMod rules (not in structure.ts — only applied with --prune)',
    plan.deleteAutomodRules.map((r) => `${c.red}-${c.reset} ${r.name}`),
  );
}

/** Refuse a --prune that would wipe most of the live server — almost certainly a typo, not intent. */
function pruneLooksSane(
  plan: Plan,
  live: { channels: unknown[]; roles: unknown[]; automodRules: unknown[] },
): boolean {
  if (
    live.automodRules.length > 0 &&
    plan.deleteAutomodRules.length / live.automodRules.length >= 0.5
  ) {
    return false;
  }
  const deleteCount =
    plan.deleteChannels.length + plan.deleteRoles.length + plan.deleteAutomodRules.length;
  const liveCount = live.channels.length + live.roles.length + live.automodRules.length;
  if (liveCount === 0) {
    return true;
  }
  return deleteCount / liveCount < 0.5;
}

export async function runSync(mode: string, options: SyncOptions): Promise<void> {
  const { rest, guildId } = initDiscordClient(mode);

  log(`Fetching live guild state (${guildId})...`);
  const [channels, roles, guild, automodRules] = await Promise.all([
    listChannels(rest, guildId),
    listRoles(rest, guildId),
    getGuild(rest, guildId),
    listAutoModRules(rest, guildId),
  ]);
  const live = { channels, roles, guild, automodRules };

  const plan = computePlan(structure, live);

  if (planIsEmpty(plan)) {
    ok('Live guild already matches structure.ts — nothing to do.');
    return;
  }

  printPlan(plan);

  if (!options.apply) {
    console.log(
      `\n${c.dim}Dry run — pass --apply to create/update. Add --prune to also delete.${c.reset}`,
    );
    return;
  }

  const desiredIsEmpty =
    structure.roles.length === 0 &&
    structure.categories.length === 0 &&
    structure.channels.length === 0;
  if (desiredIsEmpty) {
    error('structure.ts declares nothing yet — refusing to apply.');
    console.log(`${c.dim}Seed it first: bun run discord:audit -- --format=structure${c.reset}`);
    process.exit(1);
  }

  if (options.prune && !pruneLooksSane(plan, live)) {
    const deleteCount =
      plan.deleteChannels.length + plan.deleteRoles.length + plan.deleteAutomodRules.length;
    const liveCount = live.channels.length + live.roles.length + live.automodRules.length;
    error(
      `--prune would delete ${deleteCount} of ${liveCount} live channels/roles/AutoMod rules, ` +
        "or at least half of the server's AutoMod rules. Refusing.",
    );
    console.log(
      `${c.dim}If this is really intended, delete them individually in Discord instead.${c.reset}`,
    );
    process.exit(1);
  }

  console.log(`\n${c.bold}Applying...${c.reset}`);

  if (plan.guildUpdate) {
    await updateGuild(rest, guildId, plan.guildUpdate.body);
    ok('Updated guild settings');
  }

  // @everyone's role id always equals the guild id — seed the map with it
  // so permissionOverwrites' `role: '@everyone'` resolves too.
  const roleIdByName = new Map<string, string>([
    ['@everyone', guildId],
    ...live.roles.map((r): [string, string] => [r.name, r.id]),
  ]);

  for (const role of plan.createRoles) {
    const created = await createRole(rest, guildId, {
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions,
    });
    roleIdByName.set(role.name, created.id);
    ok(`Created role ${role.name}`);
  }
  for (const update of plan.updateRoles) {
    const desired = structure.roles.find((r) => r.name === update.name);
    if (!desired) {
      continue;
    }
    await updateRole(rest, guildId, update.id, {
      color: desired.color,
      hoist: desired.hoist,
      mentionable: desired.mentionable,
      permissions: desired.permissions,
    });
    ok(`Updated role ${update.name}`);
  }
  if (plan.roleReorders.length > 0) {
    await updateRolePositions(
      rest,
      guildId,
      plan.roleReorders.map((r) => ({ id: r.id, position: r.to })),
    );
    ok(`Reordered ${plan.roleReorders.length} role(s)`);
  }

  const categoryIdByName = new Map<string, string>(
    live.channels
      .filter((ch: GuildChannel) => ch.type === ChannelType.GuildCategory)
      .map((ch) => [ch.name, ch.id]),
  );
  for (const category of plan.createCategories) {
    const created = await createChannel(rest, guildId, {
      name: category.name,
      type: ChannelType.GuildCategory,
    });
    categoryIdByName.set(category.name, created.id);
    ok(`Created category ${category.name}`);
  }

  const liveTagsByChannelName = new Map(
    live.channels.map((ch) => [
      ch.name,
      new Map((ch.available_tags ?? []).map((tag) => [tag.name, { id: tag.id }])),
    ]),
  );

  for (const channel of plan.createChannels) {
    const forumFields = buildForumFields(channel, new Map());
    await createChannel(rest, guildId, {
      name: channel.name,
      type: CHANNEL_TYPE_MAP[channel.type],
      parent_id: channel.category ? categoryIdByName.get(channel.category) : undefined,
      nsfw: channel.nsfw,
      rate_limit_per_user: channel.slowmodeSeconds,
      permission_overwrites: channel.permissionOverwrites
        ? resolvePermissionOverwrites(channel.permissionOverwrites, roleIdByName)
        : undefined,
      ...forumFields,
    });
    ok(`Created channel ${channel.name}`);
  }
  for (const update of plan.updateChannels) {
    const desired = structure.channels.find((ch) => ch.name === update.name);
    if (!desired) {
      continue;
    }
    const forumFields = buildForumFields(
      desired,
      liveTagsByChannelName.get(update.name) ?? new Map(),
    );
    const updatedType =
      desired.type === 'text' || desired.type === 'announcement'
        ? CHANNEL_TYPE_MAP[desired.type]
        : undefined;
    await updateChannel(rest, update.id, {
      type: updatedType,
      // null (not undefined) moves a categorized channel to the top level —
      // diff.ts only plans the update when a real change exists, so when
      // desired declares no category, null is exactly the desired state.
      parent_id: desired.category ? categoryIdByName.get(desired.category) : null,
      nsfw: desired.nsfw,
      rate_limit_per_user: desired.slowmodeSeconds,
      permission_overwrites: desired.permissionOverwrites
        ? resolvePermissionOverwrites(desired.permissionOverwrites, roleIdByName)
        : undefined,
      ...forumFields,
    });
    ok(`Updated channel ${update.name}`);
  }
  if (plan.channelReorders.length > 0) {
    await updateChannelPositions(
      rest,
      guildId,
      plan.channelReorders.map((ch) => ({ id: ch.id, position: ch.to })),
    );
    ok(`Reordered ${plan.channelReorders.length} channel(s)`);
  }

  for (const { rule, body } of plan.createAutomodRules) {
    const resolvedBody = resolveAutomodExemptRoles({ rule, body, roleIdByName });
    await createAutoModRule(rest, guildId, resolvedBody);
    ok(`Created AutoMod rule ${resolvedBody.name}`);
  }
  for (const update of plan.updateAutomodRules) {
    const rule = structure.automod?.find((candidate) => candidate.name === update.name);
    if (!rule) {
      continue;
    }
    const resolvedBody = resolveAutomodExemptRoles({
      rule,
      body: update.body,
      roleIdByName,
    });
    try {
      await updateAutoModRule(rest, guildId, update.id, resolvedBody);
      ok(`Updated AutoMod rule ${update.name}`);
    } catch (err) {
      // Best-effort, not fail-loud like the rest of this file: some
      // AutoMod rules provisioned through Discord's own "quick setup" flow
      // reject PATCH with a 404 even though GET on the exact same URL
      // succeeds (confirmed live, including via raw fetch — not a client
      // bug). One rule's platform-side lock shouldn't abort every other
      // change in the same sync.
      warn(
        `Could not update AutoMod rule "${update.name}" (${(err as Error).message}) — ` +
          'edit it by hand in Server Settings → Safety Setup → AutoMod.',
      );
    }
  }

  if (!options.prune) {
    const pruneCount =
      plan.deleteChannels.length + plan.deleteRoles.length + plan.deleteAutomodRules.length;
    if (pruneCount > 0) {
      warn(
        `${pruneCount} channel(s)/role(s)/AutoMod rule(s) not in structure.ts were left alone (pass --prune to delete).`,
      );
    }
  } else {
    for (const ch of plan.deleteChannels) {
      await deleteChannel(rest, ch.id);
      ok(`Deleted channel/category ${ch.name}`);
    }
    for (const role of plan.deleteRoles) {
      await deleteRole(rest, guildId, role.id);
      ok(`Deleted role ${role.name}`);
    }
    for (const rule of plan.deleteAutomodRules) {
      await deleteAutoModRule(rest, guildId, rule.id);
      ok(`Deleted AutoMod rule ${rule.name}`);
    }
  }

  ok('Sync complete.');
}
