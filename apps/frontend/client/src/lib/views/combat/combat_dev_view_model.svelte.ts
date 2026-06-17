// apps/frontend/client/src/lib/views/combat/combat_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock combat state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.

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
    });

    // Simulate AI interpretation with a brief delay
    await new Promise((resolve) => setTimeout(resolve, 500));

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

    // ── Route based on classified action type ──
    switch (actionType) {
      case 'FLEE': {
        this.combatLog = [
          `[Dev Mock] AI interpreted as FLEE${modLabel}. Retreating…`,
          ...this.combatLog,
        ];
        this._endBattle('defeat');
        this.isResolvingAiAction = false;
        this.debug('executeCustomAction: resolved as FLEE — battle ended');
        return;
      }
      case 'DEFEND': {
        this.combatLog = [
          `[Dev Mock] AI interpreted as DEFEND${modLabel}. Bracing…`,
          ...this.combatLog,
        ];
        // Enemy gets a free counter-attack (standard defend behavior)
        this.simulateEnemyTurn();
        this.isResolvingAiAction = false;
        this.debug('executeCustomAction: resolved as DEFEND — enemy turn follows');
        return;
      }
      default: {
        this.isAttacking = true;
        this.combatLog = [
          `[Dev Mock] AI interpreted as ATTACK${modLabel}. Rolling…`,
          ...this.combatLog,
        ];

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
    this.enemyEntityId = 2002;
    this.activeEntities = [1001, 2002];
    this.currentTurnEntity = 1001;
    this.totalParticipants = 2;
    this._attackIndex = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _endBattle(result: 'victory' | 'defeat'): void {
    this.combatResult = result;
    this.currentTurnEntity = null;
    this.isAttacking = false;
    const label = result === 'victory' ? 'Victory!' : 'Defeat...';
    this._addLogEntry(`[Dev Mock] Battle ended — ${label}`);
  }

  private _addLogEntry(text: string): void {
    this.combatLog = [text, ...this.combatLog];
  }
}

/**
 * Factory function — returns a CombatDevViewModel with mock data.
 * Only use in (dev) routes or tests.
 */
export const getCombatDevViewModel = (options: CombatViewModelOptions): CombatDevViewModel => {
  return new CombatDevViewModel(options);
};
