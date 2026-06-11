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
    this.combatResult = null;

    return await super.initialize();
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
    this.activeEntities = [1001, 2002];
    this.currentTurnEntity = 1001;
    this.totalParticipants = 2;
    this._attackIndex = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _endBattle(result: 'victory' | 'defeat'): void {
    this.combatResult = result;
    this.currentTurnEntity = null;
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
