// apps/frontend/client/src/lib/services/game/npc_dialogue_persona.ts
// Pure persona-block assembly from authored NPC identity (C-488 AC-3).
//
// Lives outside the service module on purpose: the service-conventions guard
// (S9) permits only the singleton service instance to be exported from a
// *_service.svelte.ts file, and keeping this helper here keeps it out of the
// `$services` barrel so it needs no entry in localServicesMockBase().
import type { ContentPackNpcPersonality } from '@aikami/types';

/**
 * Builds the production NPC persona block from authored identity with
 * deterministic per-field fallback (C-488 AC-3).
 *
 * A missing `personality` yields the single canonical generic sentence
 * `You are <NPC name>, a character in a fantasy world.` in place of the
 * voice/manner block; each missing array field omits only its labelled block
 * and infers no replacement content. A partially authored NPC never falls
 * back wholesale.
 */
export const buildNpcPersona = (options: {
  npcName: string;
  identity?: {
    personality?: ContentPackNpcPersonality;
    agenda?: string[];
    knowledge?: string[];
    secrets?: string[];
    boundaries?: string[];
  };
}): string => {
  const { npcName, identity } = options;
  const lines = identity?.personality
    ? [`Voice: ${identity.personality.voice}`, `Manner: ${identity.personality.manner}`]
    : [`You are ${npcName}, a character in a fantasy world.`];

  if (identity?.agenda && identity.agenda.length > 0) {
    lines.push('', '[AGENDA]', ...identity.agenda.map((entry) => `- ${entry}`));
  }
  if (identity?.knowledge && identity.knowledge.length > 0) {
    lines.push('', '[KNOWLEDGE]', ...identity.knowledge.map((entry) => `- ${entry}`));
  }
  if (identity?.secrets && identity.secrets.length > 0) {
    lines.push('', '[SECRETS]', ...identity.secrets.map((entry) => `- ${entry}`));
  }
  if (identity?.boundaries && identity.boundaries.length > 0) {
    lines.push('', '[BOUNDARIES]', ...identity.boundaries.map((entry) => `- ${entry}`));
  }

  return lines.join('\n');
};
