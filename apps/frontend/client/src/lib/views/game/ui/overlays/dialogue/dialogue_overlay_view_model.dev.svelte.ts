// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.dev.svelte.ts
//
// Dev sandbox override — injects devtools controls for the C-162
// Action Context Menu & Interactive Dice.
// NEVER import this file from production code or non-(dev) routes.
//
// Controls:
//   - diceOutcome: 'random' | 'always_succeed' | 'always_fail'
//   - useMockAi: toggle between mock narratives and real LLM extraction
//   - mockNpcPersona: change the NPC persona on the fly
//   - interactionMode: 'freeTextFirst' (C-371) — the only supported mode
//   - autoGenerateImage: auto-generate scene images on skill check resolution
//   - generatedImageUrl: latest generated image URL (shown in inspector)

import { resolveNpcAvatarUrl, resolvePlayerAvatarUrl } from '$lib/data/npc_avatar_catalog';
import { NPC_SPRITE_EXPRESSIONS } from '$lib/data/npc_sprite_expressions';
import { diceService, imageGenerationService, ttsService } from '$services';
import type { ExpressionId } from '$types';
import {
  DialogueOverlayViewModel,
  type DialogueOverlayViewModelInterface,
  type DialogueOverlayViewModelOptions,
} from './dialogue_overlay_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dice outcome control for devtools. */
export type DiceOutcome = 'random' | 'always_succeed' | 'always_fail';

/** Interaction mode for the dialogue UI. */
export type DevInteractionMode = 'freeTextFirst';

/** NPC persona presets available in the devtools. */
export type DevNpcPreset = 'sage' | 'guard' | 'innkeeper' | 'blacksmith' | 'bandit' | 'merchant';

export type DialogueDevViewModelInterface = DialogueOverlayViewModelInterface & {
  /** Controls dice roll outcome. */
  readonly diceOutcome: DiceOutcome;

  /** Toggle between mock AI responses and real LLM extraction. */
  readonly useMockAi: boolean;

  /** Current NPC persona preset. */
  readonly mockNpcPreset: DevNpcPreset;

  /** Interaction mode: always 'freeTextFirst' (C-371). */
  readonly interactionMode: DevInteractionMode;

  /** Set dice outcome mode. */
  setDiceOutcome(outcome: DiceOutcome): void;

  /** Toggle mock AI on/off. */
  setUseMockAi(useMock: boolean): void;

  /** Change the NPC persona preset. */
  setMockNpcPreset(preset: DevNpcPreset): void;

  /** Set interaction mode (only 'freeTextFirst' is supported). */
  setInteractionMode(mode: DevInteractionMode): void;

  /** Whether auto image generation is enabled. */
  readonly autoGenerateImage: boolean;

  /** Toggle auto image generation on/off. */
  setAutoGenerateImage(enabled: boolean): void;

  /** Manually trigger a scene image generation based on current NPC + conversation. */
  generateSceneImage(): Promise<void>;

  /** Available expression IDs for the current NPC sprite. */
  readonly availableExpressions: readonly string[];

  /** Force-change the NPC expression (devtools testing). */
  setNpcExpression(expression: string): void;

  /** Toggle party member UI visibility. */
  togglePartyUi(): void;

  /** Simulate a party companion sending a message. */
  simulatePartyMessage(): void;

  /** Force a dice roll with test parameters. */
  forceDiceRoll(options: {
    checkType: string;
    difficultyClass: number;
    statModifier: string;
    statModifierValue: number;
  }): void;
};

export type DialogueDevViewModelOptions = DialogueOverlayViewModelOptions & {
  /** Initial dice outcome (default: 'random'). */
  initialDiceOutcome?: DiceOutcome;
  /** Initial mock AI setting (default: true). */
  initialUseMockAi?: boolean;
  /** Initial NPC persona preset (default: from npcData.personaId or 'sage'). */
  initialNpcPreset?: DevNpcPreset;
  /** Initial interaction mode (default: 'menu'). */
  initialInteractionMode?: DevInteractionMode;
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SUCCESS_NARRATIVES: Record<string, string[]> = {
  sage: [
    '*Elder Thrain nods slowly, his eyes gleaming with ancient wisdom.*\n"Very well, traveler. I see the truth in your words. The Crystal Caverns lie beyond the eastern ridge — but beware the shadows that dwell within."',
    '*The old sage strokes his beard thoughtfully.*\n"You have proven yourself worthy. I shall share what I know of the Lost Artifact. It lies beneath the Howling Mountains, guarded by riddles older than this kingdom."',
    '"Ah, a sharp mind! I appreciate your candor. Let me tell you about the Moonpetal Herbs — they bloom only under the full moon in the Silverwood Grove."',
  ],
  guard: [
    '*The guard captain straightens his stance, a hint of respect in his eyes.*\n"Alright, civilian. I\'ll let you pass — but stay out of trouble. The eastern road is crawling with slimes."',
    '"Hmph. You make a fair point. The bandit camp is three miles north, by the Old Mill. But if you cause trouble, it\'s on your head."',
  ],
  innkeeper: [
    '*The innkeeper beams warmly.*\n"Oh, of course, dear! Here\'s a room key and a hot meal on the house. And between you and me — the blacksmith\'s been acting strange lately..."',
    '"Well, since you asked so nicely! The merchant caravan arrives every full moon. They always stay here — best customers in town!"',
  ],
  blacksmith: [
    "*The blacksmith grumbles but softens slightly.*\n\"Fine. I'll sharpen that blade for you. But don't expect any discounts — iron doesn't grow on trees!\"",
    '"Alright, alright. I\'ll tell you about the old mine. Abandoned for decades, but I hear there\'s still good ore down there. Dangerous, though."',
  ],
  bandit: [
    "*The bandit eyes you warily, then cracks a crooked grin.*\n\"Heh. You've got guts, I'll give you that. Tell you what — there's a bigger haul in the Crystal Caverns. I'll even draw you a map.\"",
    '"Fine. You talk a good game. The Guild Master\'s been squeezing us for protection money. You want to make some real coin? Help us take him down."',
  ],
  merchant: [
    '*The merchant\'s eyes light up.*\n"Ah, a shrewd negotiator! I can tell you appreciate quality. For you — 20% off my finest wares. The Moonpetal Herbs are especially potent this season."',
    '"You drive a hard bargain, friend! Very well — I\'ll throw in this map to the Crystal Caverns. But you didn\'t get it from me!"',
  ],
};

const MOCK_FAIL_NARRATIVES: Record<string, string[]> = {
  sage: [
    '*Elder Thrain shakes his head, disappointment flickering in his ancient eyes.*\n"I am sorry, traveler. You have not convinced me. The secrets I guard are not for the unworthy."',
    '"Your words ring hollow, child. Perhaps with more wisdom you will understand. For now, I shall keep my counsel."',
  ],
  guard: [
    "*The guard captain's expression hardens.*\n\"That's enough. Move along before I run you in for disturbing the peace. You're not getting past me.\"",
    '"I don\'t like your tone, civilian. Step back or I\'ll have you in chains."',
  ],
  innkeeper: [
    "*The innkeeper's smile fades.*\n\"I'm sorry, but I don't feel comfortable sharing that information. Perhaps you should try the blacksmith — he's more... talkative.\"",
    '"I\'d rather not get involved. This town has enough trouble without me stirring the pot."',
  ],
  blacksmith: [
    '*The blacksmith slams his hammer down.*\n"I said NO! Now get out of my forge before I throw you out myself!"',
    '"Bah! You think you can sweet-talk me? I\'ve been dealing with silver-tongued merchants for forty years. Try again."',
  ],
  bandit: [
    '*The bandit spits on the ground.*\n"Nice try, but I wasn\'t born yesterday. Now get lost before my friends show up — and they\'re not as friendly as me."',
    "\"You think I'm stupid? You've got 'guard informant' written all over you. Beat it.\"",
  ],
  merchant: [
    '*The merchant crosses his arms.*\n"I\'ve heard better pitches from street urchins. The price is the price. Take it or leave it."',
    "\"I don't do business with people I don't trust. Come back when you've built a reputation in this town.\"",
  ],
};

const MOCK_PERSONA_INFO: Record<DevNpcPreset, { name: string; dialog: string; personaId: string }> =
  {
    sage: {
      name: 'Elder Thrain',
      dialog: 'Ah, a traveler! Welcome to our humble village. How may I be of assistance?',
      personaId: 'sage',
    },
    guard: {
      name: 'Guard Captain Voss',
      dialog: 'Halt! State your business in this town, stranger.',
      personaId: 'guard',
    },
    innkeeper: {
      name: 'Innkeeper Mira',
      dialog:
        'Welcome, welcome! Come in, warm yourself by the fire. What brings you to our little town?',
      personaId: 'innkeeper',
    },
    blacksmith: {
      name: 'Blacksmith Dorin',
      dialog: "*Clang! Clang!*\n...What do you want? Can't you see I'm busy?",
      personaId: 'blacksmith',
    },
    bandit: {
      name: 'Scarred Bandit',
      dialog: 'Well, well... look what the cat dragged in. You lost, friend?',
      personaId: 'bandit',
    },
    merchant: {
      name: 'Merchant Lysander',
      dialog:
        'Ah, a potential customer! Welcome, welcome! I have the finest wares this side of the kingdom!',
      personaId: 'merchant',
    },
  };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DialogueDevViewModel
  extends DialogueOverlayViewModel
  implements DialogueDevViewModelInterface
{
  diceOutcome = $state<DiceOutcome>('random');

  useMockAi = $state<boolean>(true);

  mockNpcPreset = $state<DevNpcPreset>('sage');

  interactionMode = $state<DevInteractionMode>('freeTextFirst');

  autoGenerateImage = $state<boolean>(false);

  /** Party UI toggle (C-340 placeholder). */
  showPartyUi = $state(false);

  /** Current NPC sprite name (maps to /assets/npc/{name}/ directory). */
  private _npcSpriteName = $state('gandalf');

  /** Maps sandbox persona presets to NPC sprite folder names. */
  private static readonly _personaSpriteMap: Record<DevNpcPreset, string> = {
    sage: 'gandalf',
    guard: 'aragon',
    innkeeper: 'gandalf',
    blacksmith: 'orc',
    bandit: 'orc',
    merchant: 'aragon',
  };

  /** Available expressions for the current NPC (derived from sprite folder). */
  get availableExpressions(): string[] {
    return NPC_SPRITE_EXPRESSIONS[this._npcSpriteName] ?? ['neutral'];
  }

  /** Override: returns expression-specific sprite URL via the asset store. */
  get npcAvatarUrl(): string {
    return resolveNpcAvatarUrl({
      npcId: this._npcSpriteName,
      personaId: this.mockNpcPreset,
      expression: this.npcExpression,
    });
  }

  /** Override: default player avatar via the asset store. */
  get playerAvatarUrl(): string {
    return resolvePlayerAvatarUrl({});
  }

  constructor(options: DialogueDevViewModelOptions) {
    super(options);
    this.diceOutcome = options.initialDiceOutcome ?? 'random';
    this.useMockAi = options.initialUseMockAi ?? true;
    this.mockNpcPreset = options.initialNpcPreset ?? 'sage';
    this.interactionMode = options.initialInteractionMode ?? 'freeTextFirst';

    // Ensure phase matches initial interaction mode
    // Only 'freeTextFirst' is supported — let parent class default (FREE_TEXT) stand

    // Apply initial NPC preset — overrides the default npcData from super()
    const initialPreset = options.initialNpcPreset;
    if (initialPreset && initialPreset !== 'sage') {
      this._applyNpcPreset(initialPreset);
    }

    // Initialize TTS for the sandbox (fire-and-forget)
    if (ttsService.status === 'uninitialized') {
      void ttsService.initialize();
    }
  }

  /**
   * Applies an NPC persona preset, updating name, dialog, personaId,
   * and resetting the message history. Extracted so both the constructor
   * and {@link setMockNpcPreset} can use it.
   */
  private _applyNpcPreset(preset: DevNpcPreset): void {
    const info = MOCK_PERSONA_INFO[preset];
    const self = this as unknown as { // guard-ignore lint/type-safety/casting: rAF polyfill or dev VM internals access
      _npcData: { npcId: string; npcName: string; dialog: string; personaId: string };
      messages: Array<{ id: string; role: string; content: string }>;
    };

    self._npcData.npcName = info.name;
    self._npcData.dialog = info.dialog;
    self._npcData.personaId = info.personaId;

    // Update sprite and reset expression
    this._npcSpriteName = DialogueDevViewModel._personaSpriteMap[preset] ?? 'gandalf';
    this.npcExpression = 'neutral';

    self.messages = [
      {
        id: crypto.randomUUID(),
        content: info.dialog,
        role: 'npc' as const,
      },
    ];
  }

  // ── Devtool methods ─────────────────────────────────────────────────

  /** @inheritdoc */
  setDiceOutcome(outcome: DiceOutcome): void {
    this.diceOutcome = outcome;
  }

  /** @inheritdoc */
  setUseMockAi(useMock: boolean): void {
    this.useMockAi = useMock;
  }

  /** @inheritdoc */
  setMockNpcPreset(preset: DevNpcPreset): void {
    this.mockNpcPreset = preset;
    this._applyNpcPreset(preset);
  }

  /** @inheritdoc */
  setInteractionMode(mode: DevInteractionMode): void {
    this.interactionMode = mode;
    // Force the matching phase
    this.dialoguePhase = 'FREE_TEXT';
    this.inputText = '';
  }

  /** @inheritdoc */
  setAutoGenerateImage(enabled: boolean): void {
    this.autoGenerateImage = enabled;
  }

  /** @inheritdoc */
  togglePartyUi(): void {
    this.showPartyUi = !this.showPartyUi;
  }

  /** @inheritdoc */
  simulatePartyMessage(): void {
    if (!this.showPartyUi) {
      return;
    }
    const lines = [
      '"I agree with that course of action."',
      '"Wait, I have an idea. *pulls out a map* We could take the mountain pass instead."',
      '"Careful — I sense danger ahead."',
      '*nods silently*',
      '"I remember an old tale about this place..."',
    ];
    const line = lines[Math.floor(Math.random() * lines.length)];
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        content: line,
        role: 'npc' as const,
        senderName: 'Companion',
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];
  }

  /** @inheritdoc */
  setNpcExpression(expression: string): void {
    this.npcExpression = expression as ExpressionId;
  }

  /** @inheritdoc */
  forceDiceRoll(options: {
    checkType: string;
    difficultyClass: number;
    statModifier: string;
    statModifierValue: number;
  }): void {
    const targetNumber = Math.max(1, options.difficultyClass - options.statModifierValue);
    this.skillCheckState = {
      checkType: options.checkType,
      difficultyClass: options.difficultyClass,
      statModifier: options.statModifier,
      statModifierValue: options.statModifierValue,
      targetNumber,
      rollValue: null,
      phase: 'declared',
      isSuccess: null,
    };
    this.dialoguePhase = 'DECLARED_DC';
    this.debug('forceDiceRoll', options);
  }

  /**
   * Override: provides sprite-specific available expressions.
   */
  protected override _getAvailableExpressions(): string[] {
    return this.availableExpressions;
  }

  /** @inheritdoc */
  async generateSceneImage(): Promise<void> {
    // Skip if the image service is already busy
    if (imageGenerationService.isGenerating) {
      this.debug('generateSceneImage:skipped-service-busy');
      return;
    }

    const npcName = this.npcName;
    const recentMessages = this.messages
      .slice(-3)
      .map((m) => `${m.role}: ${m.content}`)
      .join(' | ');
    const prompt = `Fantasy RPG dialogue scene with ${npcName}. ${recentMessages}. Cinematic lighting, medieval fantasy art style.`;

    const imageId = crypto.randomUUID();
    const afterMessageId = this.messages.at(-1)?.id ?? null;

    // Push a generating record so the View shows a skeleton immediately
    this.generatedImages = [
      ...this.generatedImages,
      { id: imageId, url: null, status: 'generating', afterMessageId },
    ];

    this.debug('generateSceneImage', { imageId, prompt: prompt.slice(0, 120) });

    try {
      const result = await imageGenerationService.generateImage({ prompt });

      // Update the record with the generated URL (never re-anchor)
      this.generatedImages = this.generatedImages.map((img) =>
        img.id === imageId ? { ...img, url: result.url, status: 'done' as const } : img,
      );

      this.debug('generateSceneImage:complete', {
        imageId,
        url: result.url?.slice(0, 80),
        isDemo: result.isDemo,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('generateSceneImage:failed', { imageId, message });

      // Update the record with error status
      this.generatedImages = this.generatedImages.map((img) =>
        img.id === imageId ? { ...img, status: 'error' as const } : img,
      );
    }
  }

  // ── Override: rollDice() with controlled outcomes ────────────────────

  /** @inheritdoc */
  async rollDice(): Promise<void> {
    const state = this.skillCheckState;
    if (state?.phase !== 'awaiting_click') {
      return;
    }

    // Determine roll value based on diceOutcome
    const rollValue = this._getControlledRoll(state.difficultyClass);
    const isSuccess = rollValue >= state.difficultyClass;

    this.debug('DialogueDevVM:rollDice', {
      checkType: state.checkType,
      difficultyClass: state.difficultyClass,
      diceOutcome: this.diceOutcome,
      rollValue,
      isSuccess,
    });

    // Show rolling animation
    this.skillCheckState = { ...state, phase: 'rolling' };

    // Wait for the spin animation (~1.5s)
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Reveal the result
    this.skillCheckState = { ...state, rollValue, phase: 'revealed', isSuccess };

    // Show the result as a centered banner in chat
    this.rollResultBanner = {
      value: rollValue,
      dc: state.difficultyClass,
      checkType: state.checkType,
      isSuccess,
      afterMessageId: this.messages.at(-1)?.id ?? '',
    };

    // Brief pause so the player can absorb the outcome
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    // Resolve via mock or real AI
    if (this.useMockAi) {
      await this._mockSkillCheckResolution({
        skill: state.checkType,
        difficultyClass: state.difficultyClass,
        rollValue,
        isSuccess,
      });
    } else {
      await super._executeSkillCheckAction({
        skill: state.checkType,
        difficultyClass: state.difficultyClass,
        rollValue,
        isSuccess,
      });
    }

    // Clear dice overlay and return to menu
    this.skillCheckState = null;
    this.dialoguePhase = 'FREE_TEXT';
  }

  // ── Private: controlled roll ────────────────────────────────────────

  /**
   * Returns a d20 roll value based on the current {@link diceOutcome} mode.
   *
   * - `always_succeed`: Roll = DC (minimum pass).
   * - `always_fail`: Roll = DC - 1 (just barely miss).
   * - `random`: Uses diceService for a real random roll.
   */
  private _getControlledRoll(difficultyClass: number): number {
    if (this.diceOutcome === 'always_succeed') {
      return difficultyClass; // Exactly meets DC
    }
    if (this.diceOutcome === 'always_fail') {
      return Math.max(1, difficultyClass - 1); // Just barely fails
    }
    // 'random' — use the real dice service
    return diceService.rollD20(0).natural;
  }

  // ── Private: mock skill check resolution ─────────────────────────────

  /**
   * Mock skill check resolution that uses pre-written narratives
   * instead of calling the LLM.
   *
   * Picks a narrative from the persona-specific arrays, appends it
   * to the chat, and handles any state mutations.
   */
  private async _mockSkillCheckResolution(options: {
    skill: string;
    difficultyClass: number;
    rollValue: number;
    isSuccess: boolean;
  }): Promise<void> {
    const { skill, difficultyClass, rollValue, isSuccess } = options;
    this.isResolvingSkillCheck = true;
    this._resetStreaming();

    // Pick the first narrative from the persona's array (deterministic for E2E)
    const personaNarratives = isSuccess
      ? (MOCK_SUCCESS_NARRATIVES[this.mockNpcPreset] ?? MOCK_SUCCESS_NARRATIVES.sage)
      : (MOCK_FAIL_NARRATIVES[this.mockNpcPreset] ?? MOCK_FAIL_NARRATIVES.sage);

    const narrative = personaNarratives[0] ?? '';

    this.debug('DialogueDevVM:_mockSkillCheckResolution', {
      skill,
      difficultyClass,
      rollValue,
      isSuccess,
      narrativeLength: narrative.length,
    });

    // C-401: stream the resolution narrative into a placeholder, then fill it.
    const npcMessageId = crypto.randomUUID();
    this.messages = [
      ...this.messages,
      {
        id: npcMessageId,
        content: '',
        role: 'npc' as const,
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];

    // Simulate streaming: emit the narrative word-by-word on a fixed cadence.
    const words = narrative.split(/(\s+)/);
    for (const word of words) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      this._handleStreamChunk(word);
    }
    this._flushStreamNow();
    const streamedText = this.streamingText || narrative;
    this._setMessageContent(npcMessageId, streamedText);
    this._resetStreaming();

    // Auto-generate scene image if enabled (fire-and-forget)
    if (this.autoGenerateImage) {
      void this.generateSceneImage();
    }

    this.isResolvingSkillCheck = false;
  }
}
