// scripts/src/lib/discord/automod.ts
//
// Thin typed wrappers over the Discord REST AutoMod endpoints. No business
// logic here — sync.ts decides WHAT to create/update, this module just
// knows HOW to make the call. See channels.ts/roles.ts for the same pattern.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { AutoModRule, AutoModRuleBody, AutoModRuleUpdateBody } from './types';

/** Lists every AutoMod rule through `GET /guilds/{guild.id}/auto-moderation/rules`. */
export async function listAutoModRules(rest: REST, guildId: string): Promise<AutoModRule[]> {
  return (await rest.get(Routes.guildAutoModerationRules(guildId))) as AutoModRule[];
}

/** Creates an AutoMod rule through `POST /guilds/{guild.id}/auto-moderation/rules`. */
export async function createAutoModRule(
  rest: REST,
  guildId: string,
  body: AutoModRuleBody,
): Promise<AutoModRule> {
  return (await rest.post(Routes.guildAutoModerationRules(guildId), { body })) as AutoModRule;
}

/** Updates an AutoMod rule through `PATCH /guilds/{guild.id}/auto-moderation/rules/{rule.id}`. */
export async function updateAutoModRule(
  rest: REST,
  guildId: string,
  ruleId: string,
  body: AutoModRuleUpdateBody,
): Promise<AutoModRule> {
  return (await rest.patch(Routes.guildAutoModerationRule(guildId, ruleId), {
    body,
  })) as AutoModRule;
}

/**
 * Deletes through `DELETE /guilds/{guild.id}/auto-moderation/rules/{rule.id}`
 * and records the supplied reason in Discord's audit log.
 */
export async function deleteAutoModRule(
  rest: REST,
  guildId: string,
  ruleId: string,
  reason = 'aikami discord sync',
): Promise<void> {
  await rest.delete(Routes.guildAutoModerationRule(guildId, ruleId), { reason });
}
