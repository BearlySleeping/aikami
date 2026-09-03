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
import { CLASS_REGISTRY } from '@aikami/constants';
import { characterService, choiceHistoryStore, combatService, playerStateService, timeService } from '$services';
// Direct imports to break the barrel cycle: the barrel re-exports
// gm_prompt_service before it re-exports these services (C-456).
import { partyRosterService } from '../game/party_roster_service.svelte.ts';
import { worldStateService } from '../game/world_state_service.svelte.ts';
import { npcAwarenessService } from '../npc/npc_awareness_service.svelte.ts';
import type { AddressMode } from '$types';
// Imported directly to break the barrel cycle: the barrel re-exports
// gm_prompt_service before it re-exports lorebookStore.
import { lorebookStore } from '../lorebook/lorebook_store.svelte.ts';
import type { GmCombatContext, GmPromptContext, PromptSection } from './gm_types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap for assembled prompt byte budget (C-457). */
const PROMPT_BUDGET_CAP = 6144;


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
   * @param options.chatId - Optional chat ID for CYOA choice history injection (C-245).
   * @returns A formatted system prompt string.
   */
  assemblePrompt(options: {
    mode: AddressMode;
    userMessage?: string;
    bridgeContext?: BridgeContext | null;
    chatId?: string;
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
    chatId?: string;
  }): string {
    const { mode, userMessage, bridgeContext, chatId } = options;
    const context = this.gatherContext();
    const combatContext = this.gatherCombatContext();

    // Build sections with priority metadata
    const sections: PromptSection[] = this._buildSections({
      mode,
      context,
      combatContext,
      userMessage,
      bridgeContext,
      chatId,
    });

    // Assemble with budget enforcement
    const encoder = new TextEncoder();
    const separatorBytes = encoder.encode('\n').length;
    let totalBytes = 0;
    let remainingRequiredBytes = sections.reduce(
      (total, section) =>
        section.priority === 'required' ? total + encoder.encode(section.content).length : total,
      0,
    );
    let remainingRequiredSections = sections.filter(
      (section) => section.priority === 'required',
    ).length;
    const assembledLines: string[] = [];
    const droppedSections: Array<{ name: string; bytes: number }> = [];

    const trimmedSections: Array<{ name: string; kept: number; total: number }> = [];

    for (const section of sections) {
      const sectionBytes = encoder.encode(section.content).length;
      const leadingSeparatorBytes = assembledLines.length > 0 ? separatorBytes : 0;

      if (section.priority === 'required') {
        remainingRequiredBytes -= sectionBytes;
        remainingRequiredSections -= 1;
        assembledLines.push(section.content);
        totalBytes += leadingSeparatorBytes + sectionBytes;
        continue;
      }

      const reservedRequiredBytes =
        remainingRequiredBytes + remainingRequiredSections * separatorBytes;
      const availableContentBytes =
        PROMPT_BUDGET_CAP - totalBytes - leadingSeparatorBytes - reservedRequiredBytes;

      if (sectionBytes > availableContentBytes) {
        // A list-backed section contributes what fits rather than vanishing.
        const fitted = section.partial
          ? this._fitPartialSection({
              partial: section.partial,
              remainingBytes: Math.max(0, availableContentBytes),
              encoder,
            })
          : undefined;
        if (fitted) {
          assembledLines.push(fitted.content);
          totalBytes += leadingSeparatorBytes + fitted.bytes;
          trimmedSections.push({
            name: section.name,
            kept: fitted.entryCount,
            total: section.partial?.total ?? 0,
          });
          continue;
        }
        droppedSections.push({ name: section.name, bytes: sectionBytes });
        continue;
      }

      assembledLines.push(section.content);
      totalBytes += leadingSeparatorBytes + sectionBytes;
    }

    if (trimmedSections.length > 0) {
      this.warn('assemblePrompt:sections-trimmed', {
        mode,
        trimmedSections,
        cap: PROMPT_BUDGET_CAP,
      });
    }

    // Log dropped sections for observability
    if (droppedSections.length > 0) {
      this.warn('assemblePrompt:sections-dropped', {
        mode,
        droppedSections,
        totalBytes,
        cap: PROMPT_BUDGET_CAP,
      });
    }

    const prompt = assembledLines.join('\n');

    // Warn if even required sections exceed budget (edge case)
    const finalBytes = encoder.encode(prompt).length;
    if (finalBytes > PROMPT_BUDGET_CAP) {
      this.warn('assemblePrompt:prompt-exceeds-cap', {
        byteLength: finalBytes,
        cap: PROMPT_BUDGET_CAP,
        mode,
        droppedSections: droppedSections.map((d) => d.name),
      });
    }

    return prompt;
  }

  /**
   * Builds all prompt sections with priority metadata for budget enforcement.
   * Sections are ordered by descending priority (required first, low last).
   */
  private _buildSections(options: {
    mode: AddressMode;
    context: GmPromptContext;
    combatContext: GmCombatContext | null;
    userMessage?: string;
    bridgeContext?: BridgeContext | null;
    chatId?: string;
  }): PromptSection[] {
    const { mode, context, combatContext, userMessage, bridgeContext, chatId } = options;
    const sections: PromptSection[] = [];

    // ── Required: Address-mode header ────────────────────────────────
    sections.push({
      name: 'ADDRESS MODE HEADER',
      content: this._buildAddressModeHeader(mode),
      priority: 'required',
    });

    // ── High: World state ────────────────────────────────────────────
    const worldStateLines: string[] = [
      '',
      '[WORLD STATE]',
      `World: ${context.worldName}`,
      `Region: ${context.regionName}`,
      `Location: ${context.locationName}`,
      `Description: ${context.locationDescription}`,
      `Time: ${context.timeOfDay}`,
      `Weather: ${context.weather}`,
      '[/WORLD STATE]',
    ];
    sections.push({
      name: 'WORLD STATE',
      content: worldStateLines.join('\n'),
      priority: 'high',
    });

    // ── High: Player character ───────────────────────────────────────
    const playerLines: string[] = [
      '',
      '[PLAYER CHARACTER]',
      `Name: ${context.playerCharacter.name} — ${context.playerCharacter.class} (Level ${context.playerCharacter.level})`,
      `HP: ${context.playerCharacter.currentHp}/${context.playerCharacter.maxHp}`,
      '[/PLAYER CHARACTER]',
    ];
    sections.push({
      name: 'PLAYER CHARACTER',
      content: playerLines.join('\n'),
      priority: 'high',
    });

    // ── Medium: Active quests ────────────────────────────────────────
    if (context.activeQuests.length > 0) {
      const questLines: string[] = ['', '[ACTIVE QUESTS]'];
      for (const quest of context.activeQuests) {
        questLines.push(`- ${quest.name} [${quest.status}]: ${quest.description}`);
      }
      questLines.push('[/ACTIVE QUESTS]');
      sections.push({
        name: 'ACTIVE QUESTS',
        content: questLines.join('\n'),
        priority: 'medium',
      });
    }

    // ── Medium: Combat context ───────────────────────────────────────
    if (combatContext?.isInCombat) {
      const combatLines: string[] = ['', '[COMBAT STATE]', `Round: ${combatContext.round}`, ''];
      combatLines.push('Enemies:');
      for (const enemy of combatContext.enemies) {
        combatLines.push(`- ${enemy.name} (HP: ${enemy.currentHp}/${enemy.maxHp})`);
      }
      combatLines.push('');
      combatLines.push('Allies:');
      for (const ally of combatContext.allies) {
        combatLines.push(`- ${ally.name} (HP: ${ally.currentHp}/${ally.maxHp})`);
      }
      combatLines.push('[/COMBAT STATE]');
      sections.push({
        name: 'COMBAT STATE',
        content: combatLines.join('\n'),
        priority: 'medium',
      });
    }

    // ── Required: System instructions (always included) ──────────────
    const sysLines: string[] = [
      '',
      '[SYSTEM INSTRUCTIONS]',
      'You are an AI Game Master for a fantasy RPG.',
      this._buildAddressModeInstruction(mode),
      'Describe the world vividly but concisely — 2 to 4 sentences per response.',
      'React to player actions with logical consequences.',
      'Stay in character as the narrator. Do not break the fourth wall.',
    ];

    if (mode === 'gm') {
      sysLines.push('');
      sysLines.push('[GM ONLY]');
      sysLines.push('You are in Direct GM mode. Speak to the player as a human GM would.');
      sysLines.push('You may reference game mechanics, dice rolls, and rules when appropriate.');
      sysLines.push('Offer suggestions and guidance when the player seems stuck.');
      sysLines.push('[/GM ONLY]');
    }

    sysLines.push('[/SYSTEM INSTRUCTIONS]');
    sections.push({
      name: 'SYSTEM INSTRUCTIONS',
      content: sysLines.join('\n'),
      priority: 'required',
    });

    // ── Low: Lorebook World Info (C-238) ────────────────────────────
    if (userMessage) {
      const matches = lorebookStore.scanActiveEntries({ message: userMessage });
      if (matches.length > 0) {
        const wiLines: string[] = ['', '[WORLD INFO]'];
        for (const match of matches) {
          const resolved = resolveMacros({ template: match.entry.content, context: {} });
          wiLines.push(`[${match.matchReason}]`);
          wiLines.push(resolved);
        }
        wiLines.push('[/WORLD INFO]');
        sections.push({
          name: 'WORLD INFO',
          content: wiLines.join('\n'),
          priority: 'low',
        });
      }
    }

    // ── Low: Nearby NPCs ─────────────────────────────────────────────
    // Rendered through `partial` (C-456): a location can carry hundreds of NPC
    // IDs, and dropping the whole block loses the near ones along with the far
    // ones. Budget enforcement keeps the leading entries that fit.
    if (context.nearbyNpcs.length > 0) {
      const renderNearbyNpcs = (entryCount: number): string => {
        const npcLines: string[] = ['', '[NEARBY NPCS]'];
        for (const npc of context.nearbyNpcs.slice(0, entryCount)) {
          npcLines.push(`- ${npc.name} (${npc.persona}): ${npc.currentActivity}`);
          if (npc.relationship) {
            npcLines.push(`  Relationship: ${npc.relationship}`);
          }
        }
        npcLines.push('[/NEARBY NPCS]');
        return npcLines.join('\n');
      };
      sections.push({
        name: 'NEARBY NPCS',
        content: renderNearbyNpcs(context.nearbyNpcs.length),
        priority: 'low',
        partial: { render: renderNearbyNpcs, total: context.nearbyNpcs.length },
      });
    }

    // ── Low: Party members (Party mode) ──────────────────────────────
    if (mode === 'party' && context.partyMembers.length > 0) {
      const partyLines: string[] = ['', '[PARTY MEMBERS]'];
      for (const member of context.partyMembers) {
        partyLines.push(`- ${member.name}: ${member.personality}`);
      }
      partyLines.push('[/PARTY MEMBERS]');
      sections.push({
        name: 'PARTY MEMBERS',
        content: partyLines.join('\n'),
        priority: 'low',
      });
    }

    // ── Low: CYOA Choice History (C-245) ─────────────────────────────
    if (chatId) {
      const historySection = choiceHistoryStore.formatHistorySection(chatId);
      if (historySection && historySection.length > 0) {
        sections.push({
          name: 'CYOA HISTORY',
          content: `\n${historySection}`,
          priority: 'low',
        });
      }
    }

    // ── Low: Bridge Context (C-244) ──────────────────────────────────
    if (bridgeContext) {
      if (bridgeContext.durableNotes.length > 0) {
        const notesLines: string[] = ['', '[DM NOTES (from linked OOC chat)]'];
        for (const note of bridgeContext.durableNotes) {
          notesLines.push(`- ${note}`);
        }
        notesLines.push('[/DM NOTES]');
        sections.push({
          name: 'DM NOTES',
          content: notesLines.join('\n'),
          priority: 'low',
        });
      }

      if (bridgeContext.turnInfluences.length > 0) {
        const inflLines: string[] = ['', '[INFLUENCE (this turn only)]'];
        for (const influence of bridgeContext.turnInfluences) {
          inflLines.push(`- ${influence}`);
        }
        inflLines.push('[/INFLUENCE]');
        sections.push({
          name: 'INFLUENCE',
          content: inflLines.join('\n'),
          priority: 'low',
        });
      }
    }

    return sections;
  }

  /** @inheritdoc */
  gatherContext(): GmPromptContext {
    const worldOutput = worldStateService.worldGenOutput;
    const currentLocation = worldStateService.currentLocation;

    // Resolve player class name from CLASS_REGISTRY (C-457)
    const classId = playerStateService.classId;
    const classDef = (CLASS_REGISTRY as Record<string, { name: string }>)[classId];
    const playerClassName = classDef?.name ?? 'Adventurer';

    return {
      worldName: worldOutput?.worldName ?? 'Unknown World',
      regionName: worldOutput?.locations?.[0] ?? 'Unknown Region',
      locationName: currentLocation?.name ?? 'Town Square',
      locationDescription: currentLocation?.description ?? 'A bustling town square with merchants and townsfolk.',
      timeOfDay: `${timeService.gameHour}:${String(timeService.gameMinute).padStart(2, '0')}`,
      weather: this._describeWeather(),
      activeQuests: this._gatherActiveQuests(),
      nearbyNpcs: this._gatherNearbyNpcs(),
      partyMembers: this._gatherPartyMembers(),
      playerCharacter: {
        name: characterService.selectedCharacter?.name ?? 'Hero',
        class: playerClassName,
        level: playerStateService.playerLevel,
        currentHp: playerStateService.playerHp,
        maxHp: playerStateService.playerMaxHp,
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
   * Largest leading slice of a list-backed section that fits `remainingBytes`.
   *
   * Binary search over the entry count (C-456's approach): rendering is not
   * linear in entry count — entries vary in length and a section has fixed
   * open/close tags — so counting bytes per entry would mis-fit. Returns
   * undefined when not even one entry fits, so the caller drops the section.
   */
  private _fitPartialSection(options: {
    partial: NonNullable<PromptSection['partial']>;
    remainingBytes: number;
    encoder: TextEncoder;
  }): { content: string; bytes: number; entryCount: number } | undefined {
    const { partial, remainingBytes, encoder } = options;
    let low = 0;
    let high = partial.total;
    while (low < high) {
      const candidate = Math.ceil((low + high) / 2);
      if (encoder.encode(partial.render(candidate)).length <= remainingBytes) {
        low = candidate;
      } else {
        high = candidate - 1;
      }
    }
    if (low === 0) {
      return undefined;
    }
    const content = partial.render(low);
    return { content, bytes: encoder.encode(content).length, entryCount: low };
  }

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
    const quests = worldStateService.quests;
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
    // Returns empty synchronously — the awareness service is async.
    // For synchronous prompt assembly, expose the IDs from current location.
    const location = worldStateService.currentLocation;
    if (!location?.npcIds || location.npcIds.length === 0) {
      return [];
    }

    const partyNpcIds = new Set(partyRosterService.members.map((m) => m.npcId));

    // Build minimal context from location data — full resolution with
    // NPC personalities is available via npcAwarenessService.getNearbyNpcContext()
    // for the async path (multi-NPC turn generation).
    return location.npcIds
      .filter((id) => !partyNpcIds.has(id))
      .map((id) => ({
        id,
        name: id,
        persona: 'Unknown',
        relationship: 'Unknown',
        currentActivity: 'Present',
      }));
  }

  /**
   * Gathers party members for multi-character voice distinction.
   * Returns an empty array when no party data is available.
   */
  private _gatherPartyMembers(): GmPromptContext['partyMembers'] {
    const members = partyRosterService.members;
    if (members.length === 0) {
      return [];
    }

    return members.map((member) => ({
      id: member.npcId,
      name: member.name,
      // Personality from class description — the NPC's full personality
      // is resolved asynchronously via npcAwarenessService for multi-NPC turns.
      personality: `${member.name} (${member.classId}, Level ${member.level})`,
    }));
  }
}

export { GmPromptService };

/**
 * Shared singleton instance of the GM prompt service.
 */
export const gmPromptService: GmPromptServiceInterface = GmPromptService.create({
  className: 'GmPromptService',
}) as GmPromptServiceInterface;
