// scripts/src/lib/discord/client.ts
//
// Shared REST client for Discord guild-management scripts (audit/diff/sync).
// Uses @discordjs/rest directly — NOT the full discord.js Client — because
// these scripts run once and exit; there's no need to open a gateway
// connection, declare intents, or wait for a 'ready' event just to make a
// handful of REST calls.
//
// Auth: DISCORD_BOT_TOKEN + DISCORD_GUILD_ID from scripts/.env.{mode} (see
// scripts/.env.example for how to create the bot and invite it). The bot
// must be invited with Manage Channels + Manage Roles, and its own role
// must sit above any role it's asked to create/edit (Discord's hierarchy
// rule — no way around this from the API).

import { REST } from '@discordjs/rest';
import { initScriptsEnv } from '../env/scripts_env';

export type DiscordClient = { rest: REST; guildId: string };

/** Build a REST client + guild id from scripts/.env.{mode}. Throws if unset. */
export function initDiscordClient(mode = 'production'): DiscordClient {
  initScriptsEnv(mode);

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN not set — see scripts/.env.example.');
  }
  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID not set — see scripts/.env.example.');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  return { rest, guildId };
}
