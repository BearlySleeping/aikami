// apps/frontend/client/src/lib/views/combat/combat_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock combat state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.
//
// When useRealAi is enabled, executeCustomAction routes through the real
// TextGenerationService (LLM) and generateSceneImage through the real
// ImageGenerationService (ComfyUI). When disabled (default), all AI calls
// are mocked locally for fast iteration.

import { textGenerationService } from '$lib/services/ai/text_generation_service.svelte.ts';
import { ttsService } from '$lib/services/audio/tts_service.svelte.ts';
import { imageGenerationService } from '$lib/services/image/image_generation_service.svelte.ts';
import {
  COMBAT_ACTION_SYSTEM_PROMPT,
  type CombatActionIntent,
  CombatActionSchema,
} from '../../game/core/ai/prompts/combat_action_schema.ts';
import { CombatViewModel, type CombatViewModelOptions } from './combat_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PLAYER_MAX_HP = 100;
const MOCK_ENEMY_MAX_HP = 80;

const MOCK_ENEMY_ATTACKS = [
  '[Dev Mock] Goblin dealt 15 damage!',
  '[Dev Mock] Goblin lunges with a rusty dagger — 12 damage!',
  '[Dev Mock] Goblin throws a rock — 8 damage!',
];

const MOCK_PLAYER_ATTACKS = [
  '[Dev Mock] Player strikes with sword — 18 damage!',
  '[Dev Mock] Player casts Firebolt — 22 damage!',
  '[Dev Mock] Critical hit! Player deals 30 damage!',
];

const MOCK_ENEMY_QUOTES = [
  '"You dare challenge me?!"',
  '"Pathetic! Is that all you have?"',
  '"I shall feast on your bones!"',
  '"A worthy opponent... but not worthy enough!"',
  '"You cannot defeat me!"',
];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Extended options for the dev sandbox combat VM. */
export type CombatDevViewModelOptions = CombatViewModelOptions & {
  /**
   * When true, routes executeCustomAction through the real
   * TextGenerationService (LLM) and generateSceneImage through the real
   * ImageGenerationService (ComfyUI).
   *
   * When false (default), all AI calls are mocked locally.
   */
  useRealAi?: boolean;

  /**
   * When true, BGM mood transitions route through the real Data Connect
   * {@link CombatViewModel._transitionBgmByMood} pipeline — querying
   * Data Connect for tracks by mood, then streaming from Firebase Storage
   * emulator via the AudioService crossfade.
   *
   * When false (default), uses hardcoded placeholder URLs from
   * {@link CombatViewModel._transitionBgmFallback}.
   *
   * Contract: C-151 AI Dynamic Music
   */
  useRealMusic?: boolean;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Dev sandbox override for CombatViewModel.
 *
 * Injects mock combat data so the combat UI can be tested without
 * actually triggering an encounter in the game engine.
 */
export class CombatDevViewModel extends CombatViewModel {
  /** Counter for cycling through mock attack messages. */
  private _attackIndex = 0;

  /** Whether to use real AI services instead of mock responses. */
  private _useRealAi: boolean;

  /** Whether to use real Data Connect → Storage audio pipeline for BGM. */
  private _useRealMusic: boolean;

  constructor(options: CombatDevViewModelOptions) {
    super(options);
    this._useRealAi = options.useRealAi ?? false;
    this._useRealMusic = options.useRealMusic ?? false;
  }

  /**
   * Enables or disables real AI services at runtime.
   * When enabled, subsequent {@link executeCustomAction} calls route
   * through TextGenerationService (LLM) and {@link generateSceneImage}
   * calls route through ImageGenerationService (ComfyUI).
   */
  setUseRealAi(enabled: boolean): void {
    this._useRealAi = enabled;
    this.debug('setUseRealAi', { enabled });
  }

  /**
   * Enables or disables the real Data Connect → Storage audio pipeline.
   * When enabled, BGM mood transitions query Data Connect for audio tracks
   * and stream from Firebase Storage emulator.
   */
  setUseRealMusic(enabled: boolean): void {
    this._useRealMusic = enabled;
    this.debug('setUseRealMusic', { enabled });
  }

  /**
   * Directly triggers the Data Connect → Storage → AudioService BGM pipeline
   * for a given mood. Bypasses combat flow entirely — pure audio test.
   *
   * Calls the parent's {@link CombatViewModel._transitionBgmByMood} which:
   * 1. Queries Data Connect for tracks matching the mood
   * 2. Downloads from Firebase Storage emulator
   * 3. Crossfades BGM via Web Audio API
   *
   * @param mood - Musical mood tag (e.g. 'epic', 'triumph', 'tense').
   */
  async playMusic(mood: string): Promise<void> {
    this.debug('playMusic', { mood });
    this._addLogEntry(`[Dev Mock] 🎵 Music Test: requesting mood='${mood}' → Data Connect...`);
    await (
      this as unknown as { _transitionBgmByMood: (mood: string) => Promise<void> }
    )._transitionBgmByMood(mood);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Inject mock combat state — bypass bridge events
    this.activeEntities = [1001, 2002];
    this.currentTurnEntity = 1001;
    this.totalParticipants = 2;
    this.playerHp = MOCK_PLAYER_MAX_HP;
    this.playerMaxHp = MOCK_PLAYER_MAX_HP;
    this.enemyHp = MOCK_ENEMY_MAX_HP;
    this.enemyMaxHp = MOCK_ENEMY_MAX_HP;
    this.enemyEntityId = 2002;
    this.combatResult = null;

    return await super.initialize();
  }

  // ── Override combat actions — bypass bridge, use mock sim ────────────

  /** @inheritdoc */
  override attack(): void {
    if (this.combatResult || this.isAttacking) {
      return;
    }
    this.isAttacking = true;
    // Show mock dice roll before simulation (C-148)
    this._mockDiceRoll(true);
    this.simulatePlayerAttack();
    this.isAttacking = false;
  }

  /** @inheritdoc */
  override flee(): void {
    if (this.combatResult || this.isAttacking) {
      return;
    }
    this.isAttacking = true;
    this.combatResult = 'defeat';
    this.currentTurnEntity = null;
    this._addLogEntry('[Dev Mock] Fled from battle!');
    this.isAttacking = false;
  }

  /** @inheritdoc */
  override defend(): void {
    if (this.combatResult || this.isAttacking) {
      return;
    }
    this.isAttacking = true;
    this._addLogEntry('[Dev Mock] Player takes a defensive stance!');
    // Show mock dice roll before enemy counter-attack (C-148)
    this._mockDiceRoll(true);
    this.simulateEnemyTurn();
    this.isAttacking = false;
  }

  /** @inheritdoc */
  override async executeCustomAction(prompt: string): Promise<void> {
    if (this.combatResult || this.isResolvingAiAction) {
      this.debug('executeCustomAction: blocked', {
        reason: this.combatResult ? 'combat ended' : 'already resolving',
      });
      return;
    }

    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      this.debug('executeCustomAction: empty prompt, skipping');
      return;
    }

    this.isResolvingAiAction = true;
    this.debug('executeCustomAction: resolving', {
      promptLength: trimmed.length,
      promptPreview: trimmed.slice(0, 40),
      useRealAi: this._useRealAi,
    });

    // Trigger mock dice roll (C-148)
    this._mockDiceRoll(true);

    if (this._useRealAi) {
      // ── Real AI path: call TextGenerationService ──
      await this._executeRealAiAction(trimmed);
      return;
    }

    // ── Mock AI path (default) ──
    await new Promise((resolve) => setTimeout(resolve, 500));

    // ── Gatekeeping: detect impossible item-based actions (C-149) ──
    const gatekeepResult = this._checkGatekeeping(trimmed);
    if (gatekeepResult) {
      this._addLogEntry(gatekeepResult.narrative);
      this._addLogEntry(`🚫 ${gatekeepResult.invalidReason}`);
      this.isResolvingAiAction = false;
      this.debug('executeCustomAction: gatekept', {
        invalidReason: gatekeepResult.invalidReason,
      });
      return;
    }

    // ── Keyword-based action classification (mock AI) ──
    const actionType = this._classifyMockAction(trimmed);
    this.debug('executeCustomAction: classified', { actionType, prompt: trimmed.slice(0, 40) });

    const mockNarrative = `[Dev Mock] You attempt: "${trimmed.slice(0, 40)}${trimmed.length > 40 ? '…' : ''}" — the DM nods approvingly.`;
    this._addLogEntry(mockNarrative);

    // Randomly award advantage/bonusDamage for variety (ATTACK only)
    const hasAdvantage = actionType === 'ATTACK' && Math.random() > 0.5;
    const bonusDamage = actionType === 'ATTACK' ? Math.floor(Math.random() * 4) : 0; // 0–3

    const mods: string[] = [];
    if (hasAdvantage) {
      mods.push('ADV');
    }
    if (bonusDamage > 0) {
      mods.push(`+${bonusDamage} DMG`);
    }
    const modLabel = mods.length > 0 ? ` (${mods.join(', ')})` : '';

    // ── Mock enemy quote (C-148 Combat Immersion) ──
    if (Math.random() > 0.4) {
      const quote = MOCK_ENEMY_QUOTES[Math.floor(Math.random() * MOCK_ENEMY_QUOTES.length)];
      // Simulate voice pipeline: log what would be spoken, then show quote
      this._addLogEntry(`🔊 TTS: Goblin says ${quote}`);
      this._addLogEntry(`*Goblin ${quote}*`);
    }

    // ── Mock AI Director: mood-driven BGM crossfade (C-151) ──
    this._mockMusicTransition(actionType, hasAdvantage, bonusDamage);

    // ── Route based on classified action type ──
    switch (actionType) {
      case 'FLEE': {
        this._addLogEntry(`[Dev Mock] AI interpreted as FLEE${modLabel}. Retreating…`);
        this._endBattle('defeat');
        this.isResolvingAiAction = false;
        this.debug('executeCustomAction: resolved as FLEE — battle ended');
        return;
      }
      case 'DEFEND': {
        this._addLogEntry(`[Dev Mock] AI interpreted as DEFEND${modLabel}. Bracing…`);
        // Enemy gets a free counter-attack (standard defend behavior)
        this.simulateEnemyTurn();
        this.isResolvingAiAction = false;
        this.debug('executeCustomAction: resolved as DEFEND — enemy turn follows');
        return;
      }
      default: {
        this.isAttacking = true;
        this._addLogEntry(`[Dev Mock] AI interpreted as ATTACK${modLabel}. Rolling…`);

        // Apply damage to enemy
        const damage = 10 + bonusDamage * 2;
        this.enemyHp = Math.max(0, this.enemyHp - damage);
        this._addLogEntry(
          `[Dev Mock] Custom action deals ${damage} damage! (Enemy HP: ${this.enemyHp}/${this.enemyMaxHp})`,
        );

        if (this.enemyHp <= 0) {
          this._endBattle('victory');
          this.debug('executeCustomAction: enemy defeated');
        } else {
          this.simulateEnemyTurn();
          this.debug('executeCustomAction: enemy turn follows');
        }

        this.isAttacking = false;
        this.isResolvingAiAction = false;
        break;
      }
    }
  }

  /** @inheritdoc */
  override generateSceneImage(): void {
    if (!this.inCombat) {
      return;
    }

    if (this._useRealAi) {
      this.debug('generateSceneImage: real AI — calling ImageGenerationService');
      // Build a contextual prompt from the combat state
      const prompt = [
        `Fantasy combat scene — fighting a ${this.enemyName}`,
        `Player HP: ${this.playerHp}/${this.playerMaxHp}`,
        `Enemy HP: ${this.enemyHp}/${this.enemyMaxHp}`,
        this.combatLog[0] ? `Latest action: ${this.combatLog[0].actionText}` : undefined,
      ]
        .filter(Boolean)
        .join('. ');

      void imageGenerationService
        .generateImage({ prompt })
        .then((result) => {
          this.debug('generateSceneImage: real AI complete', {
            url: result.url,
            isDemo: result.isDemo,
          });
          this.combatBackgroundImageUrl = result.url;
        })
        .catch((error) => {
          this.warn('generateSceneImage: real AI failed', error);
        });
      return;
    }

    this.debug('generateSceneImage: dev mock — setting placeholder background');
    // Use a data URI gradient so it renders without CORP issues
    this.combatBackgroundImageUrl =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
          '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" style="stop-color:#2a1a3a"/>' +
          '<stop offset="100%" style="stop-color:#1a2a3a"/></linearGradient></defs>' +
          '<rect width="800" height="600" fill="url(#g)"/>' +
          '<text x="400" y="300" font-family="monospace" font-size="28" fill="#9f7aea" text-anchor="middle" dominant-baseline="middle">' +
          '⚔️ Combat Scene ⚔️</text></svg>',
      );
  }

  /**
   * Checks whether a player action should be gatekept (rejected) because
   * they're trying to use items they don't have.
   *
   * Simulates the LLM's gatekeeping role — no network call.
   *
   * @returns A gatekeep result with narrative and invalidReason, or null if allowed.
   *
   * Contract: C-149 Combat Gatekeeping
   */
  private _checkGatekeeping(_prompt: string): { narrative: string; invalidReason: string } | null {
    const lower = _prompt.toLowerCase();

    // Detect item-usage patterns that imply the player has an item they don't
    const itemPatterns = [
      /drink.*(potion|elixir|tonic)/i,
      /use.*(potion|scroll|wand|bomb)/i,
      /throw.*(bomb|grenade|knife|dart)/i,
      /quaff/i,
    ];

    for (const pattern of itemPatterns) {
      if (pattern.test(lower)) {
        // Player is trying to use an item — gatekeep since inventory is empty
        return {
          narrative:
            'You reach for the item, fingers grasping at empty air. Your pack is bare — nothing but lint and old breadcrumbs!',
          invalidReason:
            'You reach for the item, but your inventory is empty! The goblin cackles at your foolishness. "Nice try, hero!"',
        };
      }
    }

    return null;
  }

  /**
   * Classifies a freeform prompt into a combat action type using keyword
   * heuristics. Simulates what the LLM would do — no network call.
   *
   * Priority: FLEE > DEFEND > ATTACK (default).
   */
  private _classifyMockAction(prompt: string): 'ATTACK' | 'DEFEND' | 'FLEE' {
    const lower = prompt.toLowerCase();

    // ── Flee detection ──
    const fleeKeywords = [
      'flee',
      'run away',
      'escape',
      'retreat',
      'run for it',
      'get out',
      'bolt',
      'dash away',
      'withdraw',
      'disengage',
      'surrender',
      'yield',
      'give up',
    ];
    if (fleeKeywords.some((kw) => lower.includes(kw))) {
      return 'FLEE';
    }

    // ── Defend detection ──
    const defendKeywords = [
      'defend',
      'block',
      'parry',
      'guard',
      'shield',
      'dodge',
      'brace',
      'take cover',
      'cover',
      'protect',
      'hold position',
      'stand ground',
      'stand my ground',
    ];
    if (defendKeywords.some((kw) => lower.includes(kw))) {
      return 'DEFEND';
    }

    // Default: any offensive or ambiguous action → ATTACK
    return 'ATTACK';
  }

  // ── Dev-only methods ──────────────────────────────────────────────────

  /**
   * Sets player HP to 1 to test critical low-health UI states.
   */
  forcePlayer1HP(): void {
    this.debug('forcePlayer1HP');
    this.playerHp = 1;
    this._addLogEntry('[Dev Mock] Player HP set to 1 (critical state)!');
  }

  /**
   * Simulates an enemy turn: picks a mock attack message,
   * reduces player HP by a random amount, and logs the event.
   */
  simulateEnemyTurn(): void {
    this.debug('simulateEnemyTurn');
    if (this.combatResult) {
      this._addLogEntry('[Dev Mock] Battle already ended — cannot simulate enemy turn.');
      return;
    }

    const attack =
      MOCK_ENEMY_ATTACKS[this._attackIndex % MOCK_ENEMY_ATTACKS.length] ??
      '[Dev Mock] Enemy attacks!';
    this._attackIndex++;
    const damage = Math.floor(Math.random() * 16) + 5; // 5–20 damage
    this.playerHp = Math.max(0, this.playerHp - damage);
    this._addLogEntry(`${attack} (Player HP: ${this.playerHp}/${this.playerMaxHp})`);

    if (this.playerHp <= 0) {
      this._endBattle('defeat');
    }
  }

  /**
   * Simulates a player attack: picks a mock message,
   * reduces enemy HP, and logs the event.
   */
  simulatePlayerAttack(): void {
    this.debug('simulatePlayerAttack');
    if (this.combatResult) {
      this._addLogEntry('[Dev Mock] Battle already ended — cannot attack.');
      return;
    }

    const attack =
      MOCK_PLAYER_ATTACKS[this._attackIndex % MOCK_PLAYER_ATTACKS.length] ??
      '[Dev Mock] Player attacks!';
    this._attackIndex++;
    const damage = Math.floor(Math.random() * 21) + 10; // 10–30 damage
    this.enemyHp = Math.max(0, this.enemyHp - damage);
    this._addLogEntry(`${attack} (Enemy HP: ${this.enemyHp}/${this.enemyMaxHp})`);

    if (this.enemyHp <= 0) {
      this._endBattle('victory');
    }
  }

  /**
   * Forces the battle to end in a win or loss state.
   *
   * @param victory - `true` for victory, `false` for defeat.
   */
  endBattle(victory: boolean): void {
    this.debug('endBattle', { victory });
    const result = victory ? 'victory' : 'defeat';
    this._endBattle(result);
  }

  /**
   * Resets combat to initial mock state.
   */
  resetCombat(): void {
    this.debug('resetCombat');
    this.playerHp = MOCK_PLAYER_MAX_HP;
    this.playerMaxHp = MOCK_PLAYER_MAX_HP;
    this.enemyHp = MOCK_ENEMY_MAX_HP;
    this.enemyMaxHp = MOCK_ENEMY_MAX_HP;
    this.combatLog = [];
    this.combatResult = null;
    this.combatBackgroundImageUrl = null;
    this.activeDiceRoll = null;
    this.enemyEntityId = 2002;
    this.activeEntities = [1001, 2002];
    this.currentTurnEntity = 1001;
    this.totalParticipants = 2;
    this._attackIndex = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Executes a custom combat action via the real TextGenerationService
   * (LLM). Called when {@link _useRealAi} is true.
   *
   * Calls extractStructure with the CombatActionSchema, then applies the
   * LLM's response to the mock combat flow (narrative, bonusDamage,
   * advantage, enemyQuote, generateImage). Falls back to mock classification
   * on error.
   */
  private async _executeRealAiAction(trimmed: string): Promise<void> {
    try {
      const contextualPrompt = [
        `Player HP: ${this.playerHp}/${this.playerMaxHp}`,
        `Enemy: ${this.enemyName} (HP: ${this.enemyHp}/${this.enemyMaxHp})`,
        `Player action: "${trimmed}"`,
      ].join('\n');

      this.debug('_executeRealAiAction: calling extractStructure', {
        contextualPromptLength: contextualPrompt.length,
      });

      const raw = await textGenerationService.extractStructure({
        schema: CombatActionSchema as unknown as Record<string, unknown>,
        schemaName: 'CombatActionIntent',
        prompt: contextualPrompt,
        systemPrompt: COMBAT_ACTION_SYSTEM_PROMPT,
      });

      const intent = raw as CombatActionIntent;

      this.debug('_executeRealAiAction: LLM response', {
        actionType: intent.actionType,
        bonusDamage: intent.bonusDamage,
        advantage: intent.advantage,
        generateImage: intent.generateImage,
        hasEnemyQuote: !!intent.enemyQuote,
        narrativePreview: intent.narrative.slice(0, 80),
      });

      // Append the DM narrative to the combat log
      this._addLogEntry(intent.narrative);

      // Enemy voice taunt (C-148)
      if (intent.enemyQuote && intent.enemyQuote.trim().length > 0) {
        // Log the voice pipeline: show what WOULD be spoken
        this._addLogEntry(`🔊 TTS: ${this.enemyName} says "${intent.enemyQuote}"`);
        this._addLogEntry(`*${this.enemyName} ${intent.enemyQuote}*`);
        // Fire-and-forget TTS synthesis
        void ttsService.synthesize({ text: intent.enemyQuote, voice: 'af_heart' });
      }

      // Fire image generation if the action is cinematic (C-148)
      if (intent.generateImage) {
        this.debug('_executeRealAiAction: triggering image generation');
        void imageGenerationService
          .generateImage({ prompt: `Fantasy combat scene: ${intent.narrative}` })
          .then((result) => {
            this.combatBackgroundImageUrl = result.url;
          })
          .catch((error) => {
            this.warn('_executeRealAiAction: image generation failed', error);
          });
      }

      // ── AI Director: mood-driven BGM crossfade (C-151) ──
      if (intent.sceneMood && intent.sceneMood.trim().length > 0) {
        this.debug('_executeRealAiAction: sceneMood detected', {
          sceneMood: intent.sceneMood,
        });
        void (
          this as unknown as {
            _transitionBgmFallback: (mood: string) => Promise<void>;
          }
        )._transitionBgmFallback(intent.sceneMood.trim());
      }

      // Apply combat mechanics based on LLM classification
      switch (intent.actionType) {
        case 'FLEE': {
          this._addLogEntry(`[AI] Interpreted as FLEE. Retreating…`);
          this._endBattle('defeat');
          break;
        }
        case 'DEFEND': {
          this._addLogEntry(`[AI] Interpreted as DEFEND. Bracing…`);
          this.simulateEnemyTurn();
          break;
        }
        default: {
          this.isAttacking = true;
          // Apply bonus damage from LLM
          const damage = 10 + (intent.bonusDamage ?? 0) * 2;
          const advLabel = intent.advantage ? ' [ADV]' : '';
          this._addLogEntry(
            `[AI] Interpreted as ATTACK${advLabel} (bonus +${intent.bonusDamage ?? 0} DMG). Rolling…`,
          );
          this.enemyHp = Math.max(0, this.enemyHp - damage);
          this._addLogEntry(
            `[AI] Deals ${damage} damage! (Enemy HP: ${this.enemyHp}/${this.enemyMaxHp})`,
          );

          if (this.enemyHp <= 0) {
            this._endBattle('victory');
          } else {
            this.simulateEnemyTurn();
          }
          this.isAttacking = false;
          break;
        }
      }
    } catch (error) {
      this.warn('_executeRealAiAction: failed, falling back to mock', error);
      this._addLogEntry(`[AI Error] ${(error as Error).message}. Using mock fallback.`);
      // Fall back to mock classification
      const actionType = this._classifyMockAction(trimmed);
      this._applyMockAction(trimmed, actionType, 0, false);
    } finally {
      this.isResolvingAiAction = false;
    }
  }

  /**
   * Applies mock combat results based on action classification.
   * Extracted from executeCustomAction so both mock and real-fallback
   * paths can reuse it.
   */
  private _applyMockAction(
    _trimmed: string,
    actionType: 'ATTACK' | 'DEFEND' | 'FLEE',
    bonusDamage: number,
    hasAdvantage: boolean,
  ): void {
    const mods: string[] = [];
    if (hasAdvantage) {
      mods.push('ADV');
    }
    if (bonusDamage > 0) {
      mods.push(`+${bonusDamage} DMG`);
    }
    const modLabel = mods.length > 0 ? ` (${mods.join(', ')})` : '';

    switch (actionType) {
      case 'FLEE': {
        this._addLogEntry(`[Dev Mock] AI interpreted as FLEE${modLabel}. Retreating…`);
        this._endBattle('defeat');
        this.isResolvingAiAction = false;
        return;
      }
      case 'DEFEND': {
        this._addLogEntry(`[Dev Mock] AI interpreted as DEFEND${modLabel}. Bracing…`);
        this.simulateEnemyTurn();
        this.isResolvingAiAction = false;
        return;
      }
      default: {
        this.isAttacking = true;
        this._addLogEntry(`[Dev Mock] AI interpreted as ATTACK${modLabel}. Rolling…`);

        const damage = 10 + bonusDamage * 2;
        this.enemyHp = Math.max(0, this.enemyHp - damage);
        this._addLogEntry(
          `[Dev Mock] Custom action deals ${damage} damage! (Enemy HP: ${this.enemyHp}/${this.enemyMaxHp})`,
        );

        if (this.enemyHp <= 0) {
          this._endBattle('victory');
        } else {
          this.simulateEnemyTurn();
        }

        this.isAttacking = false;
        this.isResolvingAiAction = false;
        break;
      }
    }
  }

  private _endBattle(result: 'victory' | 'defeat'): void {
    this.combatResult = result;
    this.currentTurnEntity = null;
    this.isAttacking = false;
    const label = result === 'victory' ? 'Victory!' : 'Defeat...';
    this._addLogEntry(`[Dev Mock] Battle ended — ${label}`);
  }

  /**
   * Accessor for the parent's private _logEntryCounter via structural cast.
   * The dev VM extends CombatViewModel and needs to create CombatLogEntry
   * objects matching the parent's counter state.
   */
  private get _counterNext(): number {
    const parent = this as unknown as { _logEntryCounter: number };
    return ++parent._logEntryCounter;
  }

  private get _currentTurn(): number {
    return (this as unknown as { _turnCounter: number })._turnCounter;
  }

  private _addLogEntry(text: string): void {
    const actor = text.startsWith('*') ? this.enemyName : 'System';
    this.combatLog = [
      {
        id: `log-${this._counterNext}`,
        turnNumber: this._currentTurn,
        actor,
        actionText: text,
        outcomeText: '',
      },
      ...this.combatLog,
    ] as unknown as typeof this.combatLog;
  }

  /**
   * Mock AI Director BGM transition — simulates mood-driven music
   * changes based on combat action type and severity.
   *
   * Maps action context to a mood and calls the parent's
   * {@link CombatViewModel._transitionBgmFallback} with hardcoded
   * placeholder tracks (no Firebase required).
   *
   * Contract: C-151 AI Dynamic Music
   */
  private _mockMusicTransition(
    actionType: 'ATTACK' | 'DEFEND' | 'FLEE',
    hasAdvantage: boolean,
    bonusDamage: number,
  ): void {
    let mood: string;

    if (actionType === 'FLEE') {
      mood = 'tense';
    } else if (actionType === 'DEFEND') {
      mood = 'tense';
    } else if (bonusDamage >= 3 || hasAdvantage) {
      mood = 'epic';
    } else if (this.enemyHp < this.enemyMaxHp * 0.3) {
      // Enemy is near death — shift to triumphant
      mood = 'triumph';
    } else {
      // Routine attacks — no mood change (skip)
      return;
    }

    this.debug('_mockMusicTransition', {
      actionType,
      hasAdvantage,
      bonusDamage,
      mood,
      enemyHpPercent: `${((this.enemyHp / this.enemyMaxHp) * 100).toFixed(0)}%`,
      useRealMusic: this._useRealMusic,
    });

    if (this._useRealMusic) {
      // Route through the real Data Connect → Storage pipeline (C-151)
      this._addLogEntry(`[Dev Mock] 🎵 BGM transition: mood='${mood}' → querying Data Connect...`);
      void (
        this as unknown as { _transitionBgmByMood: (mood: string) => Promise<void> }
      )._transitionBgmByMood(mood);
      return;
    }

    // Log the transition so E2E tests can verify
    this._addLogEntry(`[Dev Mock] 🎵 BGM transition: mood='${mood}' → crossfading...`);

    // Use the parent's fallback method (hardcoded placeholder URLs)
    void (
      this as unknown as { _transitionBgmFallback: (mood: string) => Promise<void> }
    )._transitionBgmFallback(mood);
  }

  /**
   * Triggers a mock d20 dice roll animation.
   * Generates a random 1–20 value and sets {@link activeDiceRoll}
   * directly on the parent class.
   *
   * @param success - Whether the roll is a hit (true) or miss (false).
   *   When not provided, randomly determines based on roll value.
   *
   * Contract: C-148 Combat Immersion
   */
  private _mockDiceRoll(success?: boolean): void {
    const value = Math.floor(Math.random() * 20) + 1;
    const isSuccess = success ?? value >= 10;

    this.debug('_mockDiceRoll', { value, isSuccess });

    // Start the rolling animation
    this.activeDiceRoll = { value, isRolling: true, isSuccess };

    // After ~1.5 seconds, reveal the final result
    setTimeout(() => {
      this.activeDiceRoll = { value, isRolling: false, isSuccess };
    }, 1500);
  }
}

/**
 * Factory function — returns a CombatDevViewModel with mock data.
 * Only use in (dev) routes or tests.
 */
export const getCombatDevViewModel = (options: CombatDevViewModelOptions): CombatDevViewModel => {
  return new CombatDevViewModel(options);
};
