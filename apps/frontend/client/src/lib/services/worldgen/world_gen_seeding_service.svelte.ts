// apps/frontend/client/src/lib/services/worldgen/world_gen_seeding_service.svelte.ts
//
// Dispatches world-gen output to the GameStateService and related subsystems.
// Seeds NPCs, locations, party arcs, and HUD widgets into the active game state.
//
// Contract: C-233

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { HudWidgetBlueprint, PartyArc, WorldGenNpc, WorldGenOutput } from '@aikami/types';
import { authService, npcService, worldStateService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for constructing the WorldGenSeedingService. */
export type WorldGenSeedingServiceOptions = BaseFrontendClassOptions & {};

/** Public interface for the seeding service. */
export type WorldGenSeedingServiceInterface = BaseFrontendClassInterface & {
  /** Seeds generated NPCs into the game state / JTON pipeline. */
  seedNpcs(options: { npcs: WorldGenNpc[] }): Promise<void>;

  /** Seeds the generated location list into the game state. */
  seedLocations(options: { locations: string[]; worldName: string }): Promise<void>;

  /** Seeds generated party arcs into the game state / quest system. */
  seedPartyArcs(options: { arcs: PartyArc[] }): Promise<void>;

  /** Seeds HUD widget blueprints into the UI preferences. */
  seedHudWidgets(options: { widgets: HudWidgetBlueprint[] }): Promise<void>;

  /** Assembles a full GM prompt text from the generated output. */
  assembleGmPrompt(options: { output: WorldGenOutput; playerGoals: string }): string;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Seeds world generation output into the game's state management layer.
 *
 * Each seed method dispatches structured data to the appropriate subsystem:
 * - NPCs → JTON pipeline (entity creation)
 * - Locations → WorldState (map nodes)
 * - Party Arcs → QuestService (quest chain scaffold)
 * - HUD Widgets → UI preferences (widget registry)
 */
export class WorldGenSeedingService
  extends BaseFrontendClass<WorldGenSeedingServiceOptions>
  implements WorldGenSeedingServiceInterface
{
  async seedNpcs(options: { npcs: WorldGenNpc[] }): Promise<void> {
    const { npcs } = options;

    if (npcs.length === 0) {
      this.debug('seedNpcs:no-npcs');
      return;
    }

    this.debug('seedNpcs', { count: npcs.length });

    const uid = authService.uid;

    for (const worldNpc of npcs) {
      this.debug('seedNpcs:creating', {
        name: worldNpc.name,
        role: worldNpc.role,
        race: worldNpc.race,
      });

      try {
        if (uid) {
          await npcService.createNpc({
            data: {
              name: worldNpc.name,
              occupation: worldNpc.role,
              personality: `${worldNpc.personality}\n\nRace: ${worldNpc.race}\nClass: ${worldNpc.class}\nDescription: ${worldNpc.description}`,
              isFriendly: true,
            },
            uid,
          });
        }

        // Also register in game state for runtime presence
        worldStateService.addNpc(worldNpc.name);
      } catch (error) {
        this.error('seedNpcs:failed', { name: worldNpc.name, error });
      }
    }

    // Record a world event for NPC population
    worldStateService.recordEvent({
      title: 'World Populated',
      description: `${npcs.length} NPCs were generated and seeded into the world.`,
      isMajor: false,
    });
  }

  async seedLocations(options: { locations: string[]; worldName: string }): Promise<void> {
    const { locations, worldName } = options;

    if (locations.length === 0) {
      this.debug('seedLocations:no-locations');
      return;
    }

    this.debug('seedLocations', { worldName, count: locations.length });

    // Store locations as world variables for the game state
    await worldStateService.setVariable('worldName', worldName);
    await worldStateService.setVariable('locations', locations);

    // Record each location for world state tracking
    for (const location of locations) {
      this.debug('seedLocations:location', { location });

      worldStateService.recordEvent({
        title: `Location Discovered: ${location}`,
        description: `${location} was added to the world of ${worldName}.`,
        isMajor: false,
      });
    }
  }

  async seedPartyArcs(options: { arcs: PartyArc[] }): Promise<void> {
    const { arcs } = options;

    if (arcs.length === 0) {
      this.debug('seedPartyArcs:no-arcs');
      return;
    }

    this.debug('seedPartyArcs', { count: arcs.length });

    // Store party arcs as world variables (quest chain data)
    await worldStateService.setVariable('partyArcs', arcs);

    // Record each arc as a major world event
    for (const arc of arcs) {
      this.debug('seedPartyArcs:arc', {
        chapter: arc.chapter,
        objectiveCount: arc.objectives.length,
      });

      worldStateService.recordEvent({
        title: `Story Arc: ${arc.chapter}`,
        description: arc.description,
        participantIds: arc.questGivers,
        isMajor: true,
      });
    }
  }

  async seedHudWidgets(options: { widgets: HudWidgetBlueprint[] }): Promise<void> {
    const { widgets } = options;

    if (widgets.length === 0) {
      this.debug('seedHudWidgets:no-widgets');
      return;
    }

    this.debug('seedHudWidgets', { count: widgets.length });

    // Store HUD widget blueprints as world variables
    await worldStateService.setVariable('hudWidgets', widgets);

    // Register each widget blueprint
    for (const widget of widgets) {
      this.debug('seedHudWidgets:widget', {
        slot: widget.slot,
        label: widget.label,
        defaultVisibility: widget.defaultVisibility,
      });
    }

    // Record a world event for HUD registration
    worldStateService.recordEvent({
      title: 'HUD Widgets Registered',
      description: `${widgets.length} HUD widgets were registered from the generated world.`,
      isMajor: false,
    });
  }

  assembleGmPrompt(options: { output: WorldGenOutput; playerGoals: string }): string {
    const { output, playerGoals } = options;

    const lines: string[] = [
      `# World: ${output.worldName}`,
      '',
      output.worldDescription,
      '',
      '## Locations',
      ...output.locations.map((l) => `- ${l}`),
      '',
      '## Key NPCs',
      ...output.npcs.map(
        (npc) => `- **${npc.name}** (${npc.race} ${npc.class}) — ${npc.role}: ${npc.description}`,
      ),
      '',
      '## Story Arcs',
      ...output.partyArcs.map(
        (arc, _i) =>
          `### ${arc.chapter}\n${arc.description}\n\n**Objectives:**\n${arc.objectives.map((o) => `- ${o}`).join('\n')}`,
      ),
      '',
      '## Player Goals',
      playerGoals,
      '',
      '## HUD Widgets',
      ...output.hudWidgets.map(
        (w) => `- ${w.label} (${w.slot}, ${w.defaultVisibility ? 'visible' : 'hidden'} by default)`,
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
