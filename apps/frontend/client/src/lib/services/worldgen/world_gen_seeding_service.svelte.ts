// apps/frontend/client/src/lib/services/worldgen/world_gen_seeding_service.svelte.ts
//
// G01 — LEGACY world-gen adapter, prompt projection only.
//
// 🔴 The four `seedNpcs` / `seedLocations` / `seedPartyArcs` / `seedHudWidgets`
// methods that used to live here were REMOVED. Each of them wrote to the live
// game from a "preview" screen: they called `worldStateService.addNpc`,
// `setVariable` and `recordEvent`, and `npcService.createNpc` with the signed-in
// user's uid. A generated world in G01 has no playable form, so nothing about
// accepting one may mutate a running campaign. That call path is gone; see
// `world_gen_draft_service.svelte.ts` for what replaces it.
//
// What remains is `assembleGmPrompt`, which is a LIVE production consumer: the
// combat ViewModel calls it to fold a world's narrative text into the GM
// prompt (`views/combat/combat_view_model.svelte.ts`, wired in
// `combat_composition.ts`). It is pure string assembly over data it is given
// and mutates nothing. Do not delete this service or its `$services` export
// line while that consumer exists.
//
// Contract: C-233 (legacy adapter), G01 (retirement of the seeding path)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { HudWidgetBlueprint, PartyArc, WorldGenNpc, WorldGenOutput } from '@aikami/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for constructing the WorldGenSeedingService. */
export type WorldGenSeedingServiceOptions = BaseFrontendClassOptions & {};

/** Public interface for the legacy adapter. */
export type WorldGenSeedingServiceInterface = BaseFrontendClassInterface & {
  /** Assembles a full GM prompt text from the generated output. */
  assembleGmPrompt(options: { output: WorldGenOutput; playerGoals: string }): string;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Legacy world-generation adapter.
 *
 * Prompt projection only — it writes nothing to world state, the NPC service,
 * the campaign or any save.
 */
export class WorldGenSeedingService
  extends BaseFrontendClass<WorldGenSeedingServiceOptions>
  implements WorldGenSeedingServiceInterface
{
  assembleGmPrompt(options: { output: WorldGenOutput; playerGoals: string }): string {
    const { output, playerGoals } = options;

    const npcs: readonly WorldGenNpc[] = output.npcs;
    const arcs: readonly PartyArc[] = output.partyArcs;
    const widgets: readonly HudWidgetBlueprint[] = output.hudWidgets;

    const lines: string[] = [
      `# World: ${output.worldName}`,
      '',
      output.worldDescription,
      '',
      '## Locations',
      ...output.locations.map((location) => `- ${location}`),
      '',
      '## Key NPCs',
      ...npcs.map(
        (npc) => `- **${npc.name}** (${npc.race} ${npc.class}) — ${npc.role}: ${npc.description}`,
      ),
      '',
      '## Story Arcs',
      ...arcs.map(
        (arc) =>
          `### ${arc.chapter}\n${arc.description}\n\n**Objectives:**\n${arc.objectives
            .map((objective) => `- ${objective}`)
            .join('\n')}`,
      ),
      '',
      '## Player Goals',
      playerGoals,
      '',
      '## HUD Widgets',
      ...widgets.map(
        (widget) =>
          `- ${widget.label} (${widget.slot}, ${widget.defaultVisibility ? 'visible' : 'hidden'} by default)`,
      ),
    ];

    return lines.join('\n');
  }
}

/** Singleton instance of the seeding service. */
export const worldGenSeedingService: WorldGenSeedingServiceInterface =
  WorldGenSeedingService.create({
    className: 'WorldGenSeedingService',
  });
