// scripts/src/lib/discord/welcome_screen.ts
//
// Thin typed wrapper over Discord's guild welcome-screen endpoints. No
// business logic here — sync.ts decides WHAT to change, this module just
// knows HOW to make the call. See channels.ts/roles.ts for the same pattern.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { WelcomeScreen, WelcomeScreenBody } from './types';

/** Discord's "Unknown Guild Welcome Screen" (code 10069) — the guild has never had one configured. */
const UNKNOWN_WELCOME_SCREEN_CODE = 10069;

/** A guild with no welcome screen configured yet — the state diffOnboarding/diffWelcomeScreen diff against. */
const NOT_CONFIGURED: WelcomeScreen = { description: null, welcome_channels: [] };

/**
 * Fetches a guild's welcome screen, mapping Discord error 10069 to an unconfigured screen.
 *
 * @param rest Authenticated Discord REST client.
 * @param guildId Guild whose welcome screen is requested.
 * @returns The configured welcome screen, or an empty projection when none exists.
 */
export async function getWelcomeScreen(rest: REST, guildId: string): Promise<WelcomeScreen> {
  try {
    return (await rest.get(Routes.guildWelcomeScreen(guildId))) as WelcomeScreen;
  } catch (err) {
    if ((err as { code?: number }).code === UNKNOWN_WELCOME_SCREEN_CODE) {
      return NOT_CONFIGURED;
    }
    throw err;
  }
}

/**
 * Applies a guild welcome-screen update.
 *
 * @param rest Authenticated Discord REST client.
 * @param guildId Guild whose welcome screen is updated.
 * @param body Complete welcome-screen update payload.
 * @returns Discord's updated welcome-screen representation.
 */
export async function updateWelcomeScreen(
  rest: REST,
  guildId: string,
  body: WelcomeScreenBody,
): Promise<WelcomeScreen> {
  return (await rest.patch(Routes.guildWelcomeScreen(guildId), { body })) as WelcomeScreen;
}
