// apps/frontend/client/src/lib/views/dev/world_gen_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the World Generation Wizard (C-233).
// Overrides _callLlm with mock LLM responses and provides debug
// prompt panel inspection. Extends the production ViewModel.
//
// Contract: C-233

import { BaseDevViewModel, type BaseDevViewModelOptions } from '@aikami/frontend/services';
import type { WorldGenInput } from '@aikami/types';
import {
  WorldGenWizardViewModel,
  type WorldGenWizardViewModelInterface,
} from '$views/worldgen/world_gen_wizard_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

/** Default mock LLM response for sandbox testing. */
const MOCK_WORLD_GEN_RESPONSE = JSON.stringify({
  worldName: "Aetheria's Echo",
  worldDescription:
    "Aetheria's Echo is a floating archipelago suspended above a sea of clouds. Ancient Aetherian technology pulses through crystal conduits embedded in the islands, powering levitation platforms and arcane forges. The central island, Arcanum Spire, houses the Fractured Council — three factions vying for control of the Aether Core. Below the clouds, the Underdrift holds the ruins of a fallen civilization and the source of the Aether Blight that's slowly corrupting the islands from below. The skyways between islands are patrolled by Sky Wardens, but rogue Aether pirates grow bolder each season, raiding trade vessels for crystal fuel.",
  npcs: [
    {
      name: 'Elena Vex',
      race: 'Human',
      class: 'Wizard',
      role: 'Quest Giver',
      description:
        'Elena is the head of the Arcanum Council, her silver hair streaked with aetherial blue. She wears ornate robes inscribed with glowing runes and carries a crystalline staff.',
      personality:
        'Wise but burdened, Elena speaks in measured tones. She trusts few outside the Council and is haunted by a failed experiment that created the Blight.',
    },
    {
      name: 'Kael Stonebeard',
      race: 'Dwarf',
      class: 'Engineer',
      role: 'Ally',
      description:
        "Kael is a gruff, soot-stained engineer who maintains the island's levitation crystals. His workshop is a maze of humming machinery and half-assembled golems.",
      personality:
        'Blunt and practical, Kael has little patience for politics but immense loyalty to those who earn his respect. He speaks in dwarven idioms and loves his creations like children.',
    },
    {
      name: 'Zara Nightwhisper',
      race: 'Tiefling',
      class: 'Rogue',
      role: 'Merchant',
      description:
        'Zara runs the Black Market Bazaar in the Underdrift. Her horns are adorned with gold rings, and her tail flicks constantly as she appraises goods and people alike.',
      personality:
        "Charming and duplicitous, Zara always has an angle. She's well-informed and willing to share information — for the right price. She never reveals her true motives.",
    },
    {
      name: 'Commander Theron',
      race: 'Human',
      class: 'Paladin',
      role: 'Antagonist',
      description:
        'Commander Theron leads the Sky Wardens with iron discipline. His plate armor is immaculate, his blade always at the ready. A scar runs from his brow to jawline.',
      personality:
        'Lawful to a fault, Theron believes the islands need a strong hand. He views the player as a destabilizing element and will oppose any change to the status quo.',
    },
  ],
  locations: [
    'Arcanum Spire',
    'The Underdrift Ruins',
    'Sky Warden Headquarters',
    'Crystalwood Grove',
    'The Floating Market',
    'Aether Core Chamber',
    'Blight Scar',
    "Kael's Workshop",
    "Zara's Bazaar",
    'The Skyway Crossroads',
  ],
  partyArcs: [
    {
      chapter: 'Chapter 1: The Blight Awakens',
      description:
        'The Aether Blight spreads faster than expected, threatening Crystalwood Grove. Elena Vex tasks the party with investigating the source and containing the outbreak.',
      objectives: [
        "Visit Crystalwood Grove and assess the Blight's spread",
        "Collect Blight samples for Kael's analysis",
        'Defend the Grove from corrupted crystal constructs',
        'Report findings to the Arcanum Council',
      ],
      questGivers: ['Elena Vex', 'Kael Stonebeard'],
    },
    {
      chapter: 'Chapter 2: Secrets of the Underdrift',
      description:
        "Kael's analysis reveals the Blight originates from deep within the Underdrift ruins. The party must descend below the clouds to find the ancient Aetherian fail-safe.",
      objectives: [
        'Secure passage to the Underdrift from Zara Nightwhisper',
        'Navigate the Underdrift ruins and avoid the Blight pockets',
        'Reactivate the ancient Aetherian purification array',
        "Survive Commander Theron's ambush on the return journey",
      ],
      questGivers: ['Kael Stonebeard', 'Zara Nightwhisper'],
    },
  ],
  hudWidgets: [
    {
      slot: 'top-left',
      label: 'Aether Compass',
      icon: 'compass',
      defaultVisibility: true,
    },
    {
      slot: 'top-right',
      label: 'Party Status',
      icon: 'heart',
      defaultVisibility: true,
    },
    {
      slot: 'bottom-center',
      label: 'Blight Meter',
      icon: 'skull',
      defaultVisibility: true,
    },
    {
      slot: 'bottom-right',
      label: 'Inventory',
      icon: 'scroll',
      defaultVisibility: true,
    },
    {
      slot: 'top-left',
      label: 'Quest Tracker',
      icon: 'star',
      defaultVisibility: false,
    },
  ],
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Interface for the sandbox ViewModel. */
export type WorldGenSandboxViewModelInterface = WorldGenWizardViewModelInterface & {
  /** Whether the debug prompt panel is visible. */
  readonly debugPanelVisible: boolean;
  /** Current debug panel prompt text. */
  readonly debugPromptText: string;
  /** Toggles the debug prompt panel. */
  toggleDebugPanel(): void;
  /** Simulates an LLM failure for testing retry logic. */
  simulateFailure(): void;
  /** Resets the LLM mock to normal (no failure simulation). */
  resetFailureSimulation(): void;
};

/** Options for constructing the sandbox ViewModel. */
export type WorldGenSandboxViewModelOptions = BaseDevViewModelOptions & {};

// ---------------------------------------------------------------------------
// Sandbox ViewModel
// ---------------------------------------------------------------------------

export class WorldGenSandboxViewModel
  extends WorldGenWizardViewModel
  implements WorldGenSandboxViewModelInterface
{
  private _debugPanelVisible = $state(false);
  private _debugPromptText = $state('');
  private _simulateFailure = false;
  private readonly _screenshotMode: boolean;

  constructor(options: WorldGenSandboxViewModelOptions) {
    super(options);
    this._screenshotMode = BaseDevViewModel.isScreenshot();

    // Auto-fill with first Surprise Me preset for quick testing
    if (!this._screenshotMode) {
      this.surpriseMe();
    }
  }

  get debugPanelVisible(): boolean {
    return this._debugPanelVisible;
  }

  get debugPromptText(): string {
    return this._debugPromptText;
  }

  toggleDebugPanel(): void {
    this._debugPanelVisible = !this._debugPanelVisible;
  }

  simulateFailure(): void {
    this._simulateFailure = true;
  }

  resetFailureSimulation(): void {
    this._simulateFailure = false;
  }

  /**
   * Overrides the base _callLlm to return mock data.
   * When simulateFailure is true, throws an error.
   * When screenshot mode is active, returns instantly.
   */
  protected async _callLlm(_input: WorldGenInput, prompt: string): Promise<string | undefined> {
    this._debugPromptText = prompt;

    if (this._simulateFailure) {
      throw new Error('Simulated LLM failure for retry testing');
    }

    // Simulate network delay (skip in screenshot mode)
    if (!this._screenshotMode) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    return MOCK_WORLD_GEN_RESPONSE;
  }
}

/** Factory function for the sandbox ViewModel. */
export const getWorldGenSandboxViewModel = (
  options: WorldGenSandboxViewModelOptions,
): WorldGenSandboxViewModelInterface => WorldGenSandboxViewModel.create(options);
