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

export async function updateWelcomeScreen(
  rest: REST,
  guildId: string,
  body: WelcomeScreenBody,
): Promise<WelcomeScreen> {
  return (await rest.patch(Routes.guildWelcomeScreen(guildId), { body })) as WelcomeScreen;
}
