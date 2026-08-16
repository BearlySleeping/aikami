// scripts/src/lib/discord/sync.ts
//
// Reconcile the live Discord guild against structure.ts (the declarative
// desired state). Two ways in:
//   runSync(mode, { apply: false })  → "diff": fetch + print the plan, no writes
//   runSync(mode, { apply: true })   → fetch, print the plan, THEN apply it
//
// Safety:
//   - apply only ever CREATES or UPDATES. Deletions are always computed and
//     shown, but never applied unless `prune: true` is also passed.
//   - if structure.ts is completely empty (nothing declared yet), apply
//     refuses to run at all — an empty desired state is "not configured",
//     not "delete everything", so this can't be used to accidentally wipe
//     a real server by running sync before structure.ts is filled in.
//   - --prune additionally refuses if it would delete a majority of the
//     live channels/roles in one shot; that's almost always a name typo or
//     a stale structure.ts, not intent.

import { ChannelType } from 'discord-api-types/v10';
import { c, error, log, ok, warn } from '../cli_utils';
import { createChannel, deleteChannel, listChannels, updateChannel } from './channels';
import { initDiscordClient } from './client';
import type { Plan } from './diff';
import { CHANNEL_TYPE_MAP, computePlan, planIsEmpty } from './diff';
import { createRole, deleteRole, listRoles, updateRole } from './roles';
import { structure } from './structure';
import type { GuildChannel } from './types';

export type SyncOptions = { apply: boolean; prune: boolean };

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
    'Update roles',
    plan.updateRoles.map((r) => `${c.cyan}~${c.reset} ${r.name}: ${r.changes.join(', ')}`),
  );
  section(
    'Update channels',
    plan.updateChannels.map((ch) => `${c.cyan}~${c.reset} ${ch.name}: ${ch.changes.join(', ')}`),
  );
  section(
    'Delete channels/categories (not in structure.ts — only applied with --prune)',
    plan.deleteChannels.map((ch) => `${c.red}-${c.reset} ${ch.name}`),
  );
  section(
    'Delete roles (not in structure.ts — only applied with --prune)',
    plan.deleteRoles.map((r) => `${c.red}-${c.reset} ${r.name}`),
  );
}

/** Refuse a --prune that would wipe most of the live server — almost certainly a typo, not intent. */
function pruneLooksSane(plan: Plan, live: { channels: unknown[]; roles: unknown[] }): boolean {
  const deleteCount = plan.deleteChannels.length + plan.deleteRoles.length;
  const liveCount = live.channels.length + live.roles.length;
  if (liveCount === 0) {
    return true;
  }
  return deleteCount / liveCount < 0.5;
}

export async function runSync(mode: string, options: SyncOptions): Promise<void> {
  const { rest, guildId } = initDiscordClient(mode);

  log(`Fetching live guild state (${guildId})...`);
  const [channels, roles] = await Promise.all([
    listChannels(rest, guildId),
    listRoles(rest, guildId),
  ]);
  const live = { channels, roles };

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
    error(
      `--prune would delete ${plan.deleteChannels.length + plan.deleteRoles.length} of ${
        live.channels.length + live.roles.length
      } live channels/roles — that's over half the server. Refusing.`,
    );
    console.log(
      `${c.dim}If this is really intended, delete them individually in Discord instead.${c.reset}`,
    );
    process.exit(1);
  }

  console.log(`\n${c.bold}Applying...${c.reset}`);

  for (const role of plan.createRoles) {
    await createRole(rest, guildId, {
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions,
    });
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

  for (const channel of plan.createChannels) {
    await createChannel(rest, guildId, {
      name: channel.name,
      type: CHANNEL_TYPE_MAP[channel.type],
      parent_id: channel.category ? categoryIdByName.get(channel.category) : undefined,
      topic: channel.topic,
      nsfw: channel.nsfw,
    });
    ok(`Created channel ${channel.name}`);
  }
  for (const update of plan.updateChannels) {
    const desired = structure.channels.find((ch) => ch.name === update.name);
    if (!desired) {
      continue;
    }
    await updateChannel(rest, update.id, {
      type: CHANNEL_TYPE_MAP[desired.type],
      // null (not undefined) moves a categorized channel to the top level —
      // diff.ts only plans the update when a real change exists, so when
      // desired declares no category, null is exactly the desired state.
      parent_id: desired.category ? categoryIdByName.get(desired.category) : null,
      topic: desired.topic,
      nsfw: desired.nsfw,
    });
    ok(`Updated channel ${update.name}`);
  }

  if (!options.prune) {
    if (plan.deleteChannels.length + plan.deleteRoles.length > 0) {
      warn(
        `${plan.deleteChannels.length + plan.deleteRoles.length} channel(s)/role(s) not in structure.ts were left alone (pass --prune to delete).`,
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
  }

  ok('Sync complete.');
}
