// packages/backend/discord-bot/src/lib/types.ts
//
// What this bot needs from its environment — the package declares the
// SHAPE and the KEYS, whatever process hosts it (apps/backend/worker,
// today) decides HOW to source them (Secret Manager, a local .env, etc.).
// Keeps the bot's logic independent of any one hosting mechanism.

export const DISCORD_BOT_REQUIRED_ENV_KEYS = [
  'DISCORD_BOT_TOKEN',
  'GITHUB_ISSUES_TOKEN',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
] as const;

export type DiscordBotEnv = Record<(typeof DISCORD_BOT_REQUIRED_ENV_KEYS)[number], string>;
