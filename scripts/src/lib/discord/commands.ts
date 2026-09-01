// scripts/src/lib/discord/commands.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors Discord's wire-format JSON keys (custom_id, ...)
//
// Registers the app-level slash commands the Interactions Endpoint handles
// (packages/backend/discord-bot/src/lib/interactions, hosted by
// apps/backend/worker — see docs/contracts/C-418-p2 OQ-3): /ask (AI Q&A
// about the project). Bug reports and feature requests are
// filed as posts in the #support forum instead — see
// scripts/src/lib/discord/structure.ts — not through a slash command.
//
// GUILD-scoped (Routes.applicationGuildCommands), not global
// (Routes.applicationCommands): a global command registration takes up to
// an hour to propagate everywhere, which only matters for a bot living in
// many guilds — Aikami's bot lives in exactly one (DISCORD_GUILD_ID from
// @aikami/constants), where a guild command propagates near-instantly
// instead. Switch back to Routes.applicationCommands(appId) (and drop the
// guildId argument) if this bot ever needs to serve more than one guild.
//
// Registration needs DISCORD_BOT_TOKEN + DISCORD_APP_ID — it's a PUT
// against the application's command list for one specific guild.

import { DISCORD_GUILD_ID } from '@aikami/constants';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { initScriptsEnv } from '../env/scripts_env';

const COMMANDS = [
  {
    name: 'ask',
    description: 'Ask the project AI a question about Aikami',
    type: 1,
    options: [
      {
        name: 'question',
        description: 'What do you want to know?',
        type: 3, // STRING
        required: true,
      },
    ],
  },
];

export async function syncDiscordCommands(mode = 'production'): Promise<void> {
  initScriptsEnv(mode);

  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APP_ID;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN not set — see scripts/.env.example.');
  }
  if (!appId) {
    throw new Error('DISCORD_APP_ID not set — see scripts/.env.example.');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  // A full PUT replaces the ENTIRE guild command list with COMMANDS —
  // intentional (this file is the single source of truth for the app's
  // commands), but means any command registered outside of this file gets
  // deleted the next time this runs.
  await rest.put(Routes.applicationGuildCommands(appId, DISCORD_GUILD_ID), { body: COMMANDS });
}
