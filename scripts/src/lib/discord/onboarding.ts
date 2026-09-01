// scripts/src/lib/discord/onboarding.ts
//
// Thin typed wrapper over Discord's guild-onboarding endpoints. No business
// logic here — sync.ts resolves names to ids and reuses live prompt/option
// ids so a re-apply doesn't duplicate them (see its buildOnboardingBody);
// this module just knows HOW to make the calls. See channels.ts/roles.ts
// for the same pattern.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { Onboarding, OnboardingBody } from './types';

/**
 * Fetches a guild's current onboarding configuration.
 *
 * @param rest Authenticated Discord REST client.
 * @param guildId Guild whose onboarding configuration is requested.
 * @returns Discord's current onboarding representation.
 */
export async function getOnboarding(rest: REST, guildId: string): Promise<Onboarding> {
  return (await rest.get(Routes.guildOnboarding(guildId))) as Onboarding;
}

/**
 * `PUT /guilds/{id}/onboarding` — despite the verb, this REPLACES the whole
 * onboarding config in one call (not a partial patch): `body` must be the
 * COMPLETE desired state (all prompts, all options), not just what changed.
 *
 * @param rest Authenticated Discord REST client.
 * @param guildId Guild whose onboarding configuration is replaced.
 * @param body Complete desired onboarding configuration.
 * @returns Discord's updated onboarding representation.
 */
export async function updateOnboarding(
  rest: REST,
  guildId: string,
  body: OnboardingBody,
): Promise<Onboarding> {
  return (await rest.put(Routes.guildOnboarding(guildId), { body })) as Onboarding;
}
