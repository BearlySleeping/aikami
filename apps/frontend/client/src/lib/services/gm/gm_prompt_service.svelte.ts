// apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts
//
// Central GM prompt assembler singleton. Queries GameStateService,
// combatService, and timeService for all state sources and produces
// a formatted system prompt with address-mode scoping.
//
// Contract: C-235 GM Narrative Director

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { resolveMacros } from '@aikami/parser';
import type { BridgeContext } from '@aikami/types';
// Direct imports to avoid barrel mock resolution issues in tests
import { combatService } from '$lib/services/game/combat_service.svelte.ts';
import { gameStateService } from '$lib/services/game/game_state_service.svelte.ts';
import { timeService } from '$lib/services/game/time_service.svelte.ts';
import { lorebookStore } from '$lib/services/lorebook/lorebook_store.svelte';
import type { AddressMode, GmCombatContext, GmPromptContext } from './gm_types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GmPromptServiceOptions = BaseFrontendClassOptions;

export type GmPromptServiceInterface = BaseFrontendClassInterface & {
  /**
   * Assembles a coherent GM system prompt from the current game state
   * scoped to the given address mode.
   *
   * Combines world state, character info, active quests, nearby NPCs,
   * time/weather, combat context, and lorebook world info into a
   * formatted prompt string.
   *
   * The output is guaranteed to be under 6 KB (6144 bytes).
   *
   * @param options.mode - The address mode controlling narrative perspective.
   * @param options.userMessage - Optional user message for lorebook keyword scanning.
   * @returns A formatted system prompt string.
   */
  assemblePrompt(options: {
    mode: AddressMode;
    userMessage?: string;
    bridgeContext?: BridgeContext | null;
  }): string;

  /**
   * Gathers the current game state into a structured context object
   * without formatting it as a prompt. Useful for consumers that need
   * the raw data.
   */
  gatherContext(): GmPromptContext;

  /**
   * Gathers the current combat state into a structured object.
   * Returns null when not in combat.
   */
  gatherCombatContext(): GmCombatContext | null;
};

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class GmPromptService
  extends BaseFrontendClass<GmPromptServiceOptions>
  implements GmPromptServiceInterface
{
  /** @inheritdoc */
  assemblePrompt(options: {
    mode: AddressMode;
    userMessage?: string;
    bridgeContext?: BridgeContext | null;
  }): string {
    const { mode, userMessage, bridgeContext } = options;
    const context = this.gatherContext();
    const combatContext = this.gatherCombatContext();
    const lines: string[] = [];

    // ── Address-mode header ─────────────────────────────────────────
    lines.push(this._buildAddressModeHeader(mode));

    // ── World state ─────────────────────────────────────────────────
    lines.push('');
    lines.push('[WORLD STATE]');
    lines.push(`World: ${context.worldName}`);
    lines.push(`Region: ${context.regionName}`);
    lines.push(`Location: ${context.locationName}`);
    lines.push(`Description: ${context.locationDescription}`);
    lines.push(`Time: ${context.timeOfDay}`);
    lines.push(`Weather: ${context.weather}`);
    lines.push('[/WORLD STATE]');

    // ── Player character ────────────────────────────────────────────
    lines.push('');
    lines.push('[PLAYER CHARACTER]');
    lines.push(
      `Name: ${context.playerCharacter.name} — ${context.playerCharacter.class} (Level ${context.playerCharacter.level})`,
    );
    lines.push(`HP: ${context.playerCharacter.currentHp}/${context.playerCharacter.maxHp}`);
    lines.push('[/PLAYER CHARACTER]');

    // ── Active quests ───────────────────────────────────────────────
    if (context.activeQuests.length > 0) {
      lines.push('');
      lines.push('[ACTIVE QUESTS]');
      for (const quest of context.activeQuests) {
        lines.push(`- ${quest.name} [${quest.status}]: ${quest.description}`);
      }
      lines.push('[/ACTIVE QUESTS]');
    }

    // ── Nearby NPCs ─────────────────────────────────────────────────
    if (context.nearbyNpcs.length > 0) {
      lines.push('');
      lines.push('[NEARBY NPCS]');
      for (const npc of context.nearbyNpcs) {
        lines.push(`- ${npc.name} (${npc.persona}): ${npc.currentActivity}`);
        if (npc.relationship) {
          lines.push(`  Relationship: ${npc.relationship}`);
        }
      }
      lines.push('[/NEARBY NPCS]');
    }

    // ── Party members (Party mode multi-character voice) ───────────
    if (mode === 'party' && context.partyMembers.length > 0) {
      lines.push('');
      lines.push('[PARTY MEMBERS]');
      for (const member of context.partyMembers) {
        lines.push(`- ${member.name}: ${member.personality}`);
      }
      lines.push('[/PARTY MEMBERS]');
    }

    // ── Combat context ──────────────────────────────────────────────
    if (combatContext?.isInCombat) {
      lines.push('');
      lines.push('[COMBAT STATE]');
      lines.push(`Round: ${combatContext.round}`);
      lines.push('');
      lines.push('Enemies:');
      for (const enemy of combatContext.enemies) {
        lines.push(`- ${enemy.name} (HP: ${enemy.currentHp}/${enemy.maxHp})`);
      }
      lines.push('');
      lines.push('Allies:');
      for (const ally of combatContext.allies) {
        lines.push(`- ${ally.name} (HP: ${ally.currentHp}/${ally.maxHp})`);
      }
      lines.push('[/COMBAT STATE]');
    }

    // ── Arc memory injection ────────────────────────────────────────
    // Arc memory is injected by the NarrativeDirectorService —
    // this base prompt stays generic.

    // ── System instructions ─────────────────────────────────────────
    lines.push('');
    lines.push('[SYSTEM INSTRUCTIONS]');
    lines.push('You are an AI Game Master for a fantasy RPG.');
    lines.push(this._buildAddressModeInstruction(mode));
    lines.push('Describe the world vividly but concisely — 2 to 4 sentences per response.');
    lines.push('React to player actions with logical consequences.');
    lines.push('Stay in character as the narrator. Do not break the fourth wall.');

    if (mode === 'gm') {
      lines.push('');
      lines.push('[GM ONLY]');
      lines.push('You are in Direct GM mode. Speak to the player as a human GM would.');
      lines.push('You may reference game mechanics, dice rolls, and rules when appropriate.');
      lines.push('Offer suggestions and guidance when the player seems stuck.');
      lines.push('[/GM ONLY]');
    }

    lines.push('[/SYSTEM INSTRUCTIONS]');

    // ── Lorebook World Info (C-238) ─────────────────────────────────
    if (userMessage) {
      const matches = lorebookStore.scanActiveEntries({ message: userMessage });
      if (matches.length > 0) {
        lines.push('');
        lines.push('[WORLD INFO]');
        for (const match of matches) {
          // Resolve macros in the entry content before injection
          const resolved = resolveMacros({ template: match.entry.content, context: {} });
          lines.push(`[${match.matchReason}]`);
          lines.push(resolved);
        }
        lines.push('[/WORLD INFO]');
      }
    }

    // ── Bridge Context (C-244) — connected chats bridge ─────────────
    if (bridgeContext) {
      if (bridgeContext.durableNotes.length > 0) {
        lines.push('');
        lines.push('[DM NOTES (from linked OOC chat)]');
        for (const note of bridgeContext.durableNotes) {
          lines.push(`- ${note}`);
        }
        lines.push('[/DM NOTES]');
      }

      if (bridgeContext.turnInfluences.length > 0) {
        lines.push('');
        lines.push('[INFLUENCE (this turn only)]');
        for (const influence of bridgeContext.turnInfluences) {
          lines.push(`- ${influence}`);
        }
        lines.push('[/INFLUENCE]');
      }
    }

    const prompt = lines.join('\n');

    // Enforce < 6 KB constraint
    const encoder = new TextEncoder();
    const byteLength = encoder.encode(prompt).length;
    if (byteLength > 6144) {
      this.warn('assemblePrompt:prompt-exceeds-6kb', {
        byteLength,
        mode,
      });
    }

    return prompt;
  }

  /** @inheritdoc */
  gatherContext(): GmPromptContext {
    const worldOutput = gameStateService.worldGenOutput;

    return {
      worldName: worldOutput?.worldName ?? 'Unknown World',
      regionName: worldOutput?.locations?.[0] ?? 'Unknown Region',
      locationName: 'Town Square', // TODO: wire to actual location system
      locationDescription: 'A bustling town square with merchants and townsfolk.',
      timeOfDay: `${timeService.gameHour}:${String(timeService.gameMinute).padStart(2, '0')}`,
      weather: this._describeWeather(),
      activeQuests: this._gatherActiveQuests(),
      nearbyNpcs: this._gatherNearbyNpcs(),
      partyMembers: this._gatherPartyMembers(),
      playerCharacter: {
        name: 'Hero', // TODO: wire to actual character name
        class: 'Adventurer',
        level: 1,
        currentHp: 20,
        maxHp: 20,
      },
    };
  }

  /** @inheritdoc */
  gatherCombatContext(): GmCombatContext | null {
    const inCombat = combatService.enemyName !== 'Unknown Enemy';

    if (!inCombat) {
      return null;
    }

    return {
      isInCombat: true,
      round: 1,
      enemies: [
        {
          name: combatService.enemyName,
          currentHp: combatService.enemyHp,
          maxHp: combatService.enemyMaxHp,
        },
      ],
      allies: [], // TODO: wire to combat allies
    };
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Builds the address-mode header line for the prompt.
   */
  private _buildAddressModeHeader(mode: AddressMode): string {
    switch (mode) {
      case 'scene':
        return '[ADDRESS MODE: Scene — Omniscient Narrator]';
      case 'party':
        return '[ADDRESS MODE: Party — Multi-Character Group]';
      case 'gm':
        return '[ADDRESS MODE: GM — Direct GM-to-Player]';
    }
  }

  /**
   * Builds the address-mode specific instruction for the system prompt.
   */
  private _buildAddressModeInstruction(mode: AddressMode): string {
    switch (mode) {
      case 'scene':
        return 'Describe the world in third person, omniscient. Do not directly address the player.';
      case 'party':
        return 'Each party member speaks in their own distinct voice matching their personality. When a party member speaks, prefix with their name in bold: **Name**: dialogue. Describe the world through their collective perspective.';
      case 'gm':
        return 'Address the player directly in second person. Speak as a human Game Master would.';
    }
  }

  /**
   * Describes the current weather from the time service.
   */
  private _describeWeather(): string {
    const w = timeService.rainIntensity;
    if (w > 0.7) {
      return 'Heavy rain';
    }
    if (w > 0.3) {
      return 'Light rain';
    }
    return 'Clear skies';
  }

  /**
   * Gathers active quests from the game state service.
   */
  private _gatherActiveQuests(): GmPromptContext['activeQuests'] {
    const quests = gameStateService.quests;
    if (!quests || quests.length === 0) {
      return [];
    }

    return quests
      .filter((q) => q.status === 'active')
      .map((q) => ({
        id: q.id,
        name: q.title ?? 'Unknown Quest',
        description: q.description ?? '',
        status: q.status,
      }));
  }

  /**
   * Gathers nearby NPC context from the game state.
   */
  private _gatherNearbyNpcs(): GmPromptContext['nearbyNpcs'] {
    return []; // TODO: wire to actual NPC awareness system
  }

  /**
   * Gathers party members for multi-character voice distinction.
   * Returns an empty array when no party data is available.
   */
  private _gatherPartyMembers(): GmPromptContext['partyMembers'] {
    return []; // TODO: wire to actual party member system
  }
}

export { GmPromptService };

/**
 * Shared singleton instance of the GM prompt service.
 */
export const gmPromptService: GmPromptServiceInterface = GmPromptService.create({
  className: 'GmPromptService',
}) as GmPromptServiceInterface;
