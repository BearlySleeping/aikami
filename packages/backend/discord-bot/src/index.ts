// packages/backend/discord-bot/src/index.ts
//
// Always-on Discord Gateway bot for #bugs-features-requests — forum
// auto-reply, moderator-triggered GitHub issue creation, and in-thread LLM
// replies. A persistent WebSocket connection (unlike a stateless HTTP
// Interactions Endpoint), so it needs a long-running host — see
// apps/backend/worker, the generic always-on-VM app that starts this.
//
// This package only knows how to run the bot GIVEN an env; it has no
// opinion on where DISCORD_BOT_TOKEN etc. come from or what process hosts
// it — see lib/types.ts.

import { logger } from '@aikami/logger';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { handleMessageCreate } from './lib/handlers/message_create';
import { handleThreadCreate } from './lib/handlers/thread_create';
import { handleGuildMemberUpdate } from './lib/role_sync';
import type { DiscordBotEnv } from './lib/types';

export { discordInteractions } from './lib/interactions/handler';
export {
  DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS,
  type DiscordInteractionsEnv,
} from './lib/interactions/types';
export { DISCORD_BOT_REQUIRED_ENV_KEYS, type DiscordBotEnv } from './lib/types';

/**
 * Connects to the Discord Gateway and wires up the forum handlers.
 * Resolves once logged in — the connection itself stays open until the
 * process exits (discord.js handles Gateway reconnects on its own).
 */
export async function startDiscordBot(env: DiscordBotEnv): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info(`discord-bot: logged in as ${c.user.tag}`);
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    handleGuildMemberUpdate(oldMember, newMember).catch((err) => {
      logger.error(`discord-bot: unhandled guildMemberUpdate error: ${(err as Error).message}`);
    });
  });

  client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    handleThreadCreate(thread, newlyCreated).catch((err) => {
      logger.error(`discord-bot: unhandled threadCreate error: ${(err as Error).message}`);
    });
  });

  client.on(Events.MessageCreate, (message) => {
    handleMessageCreate(message, client, env).catch((err) => {
      logger.error(`discord-bot: unhandled messageCreate error: ${(err as Error).message}`);
    });
  });

  client.on(Events.Error, (err) => {
    logger.error(`discord-bot: client error: ${err.message}`);
  });

  await client.login(env.DISCORD_BOT_TOKEN);
  return client;
}
