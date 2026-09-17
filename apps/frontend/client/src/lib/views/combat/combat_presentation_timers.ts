// apps/frontend/client/src/lib/views/combat/combat_presentation_timers.ts
//
// The combat surface's delayed PRESENTATION timers (review F9).
//
// Two animations are scheduled rather than immediate: the damage-flash reset and
// the dice reveal/clear. Both used to be bare `setTimeout` calls with no run
// binding, so a timer left over from a finished encounter could clear or
// overwrite the presentation state of the encounter that replaced it.
//
// Both are now scheduled through {@link createRunScopedTimer}, which re-checks
// the encounter-run identity at FIRE time. Extracted from the ~2.5k-line combat
// ViewModel (on the source-file-size guard's baseline) so the timing policy is
// reviewable on its own; the ViewModel keeps the reactive runes and delegates.
//
// Contract: C-148, C-532

import type { EncounterRunIdentity } from '../../services/game/combat_ai_lifecycle';
import { createRunScopedTimer } from './combat_run_scoped_timer.ts';

/** The dice-roll presentation state the ViewModel renders. */
export type CombatDiceRoll = {
  value: number;
  isRolling: boolean;
  isSuccess: boolean;
};

export type CombatPresentationTimerDeps = {
  /** The run identity that was current when a callback was scheduled. */
  currentRun(): EncounterRunIdentity | undefined;
  /** Whether an identity still belongs to the active run. */
  isCurrentRun(identity: EncounterRunIdentity | undefined): boolean;
  /** Sets the damage-flash flags (both are cleared together on expiry). */
  setDamageFlash(target: 'player' | 'enemy', active: boolean): void;
  /** Clears both flash flags when the flash window expires. */
  clearDamageFlash(): void;
  /** Publishes the dice-roll presentation state, or clears it with `null`. */
  setDiceRoll(roll: CombatDiceRoll | null): void;
  debug?(event: string, data?: Record<string, unknown>): void;
};

/** How long the damage flash stays lit. */
const DAMAGE_FLASH_MS = 400;
/** How long the d20 spins before the result is revealed. */
const DICE_ROLL_MS = 1500;
/** How long the revealed result stays on screen. */
const DICE_HOLD_MS = 1500;

/**
 * Owns the delayed presentation callbacks for one combat surface.
 *
 * Separate schedulers per purpose: re-triggering a dice reveal must not cancel a
 * damage flash, and vice versa.
 */
export class CombatPresentationTimers {
  private readonly _deps: CombatPresentationTimerDeps;
  private readonly _flashTimers;
  private readonly _diceTimers;

  constructor(deps: CombatPresentationTimerDeps) {
    this._deps = deps;
    const isCurrent = (identity: EncounterRunIdentity | undefined): boolean =>
      deps.isCurrentRun(identity);
    this._flashTimers = createRunScopedTimer({ isCurrent });
    this._diceTimers = createRunScopedTimer({ isCurrent });
  }

  /**
   * Lights the damage flash on one portrait and schedules its reset.
   *
   * Run-scoped: a flash triggered in one encounter must not clear the flash
   * state of the encounter that replaced it. Re-scheduling resets the window, so
   * rapid hits extend the animation.
   */
  flash(target: 'player' | 'enemy'): void {
    this._deps.setDamageFlash(target, true);
    this._flashTimers.clearAll();
    this._flashTimers.schedule({
      identity: this._deps.currentRun(),
      delayMs: DAMAGE_FLASH_MS,
      fire: () => {
        this._deps.clearDamageFlash();
      },
    });
  }

  /**
   * Parses a d20 roll out of a combat-log message and animates it.
   *
   * The engine emits messages like "Player rolls 17 (+4 = 21) to hit." or
   * "Enemy rolls 5 (+3 = 8) vs Evasion 12 — Miss!". Success/failure is read from
   * the message; a message with no dice pattern is a no-op.
   *
   * Both the reveal and the later clear are run-scoped, so a reveal queued by a
   * finished encounter can never overwrite the dice of the encounter that
   * replaced it.
   */
  dice(message: string): void {
    const diceMatch = message.match(/(?:Player|Enemy) rolls (\d+)/);
    if (!diceMatch) {
      return;
    }
    const value = Number.parseInt(diceMatch[1], 10);
    if (Number.isNaN(value) || value < 1 || value > 20) {
      return;
    }
    const isSuccess = !message.includes('Miss!');
    this._deps.debug?.('_triggerDiceRoll', {
      value,
      isSuccess,
      messagePreview: message.slice(0, 60),
    });

    this._deps.setDiceRoll({ value, isRolling: true, isSuccess });
    this._diceTimers.clearAll();
    const identity = this._deps.currentRun();
    this._diceTimers.schedule({
      identity,
      delayMs: DICE_ROLL_MS,
      fire: () => {
        this._deps.setDiceRoll({ value, isRolling: false, isSuccess });
        this._diceTimers.schedule({
          identity,
          delayMs: DICE_HOLD_MS,
          fire: () => {
            this._deps.setDiceRoll(null);
          },
        });
      },
    });
  }

  /** Cancels every pending presentation callback (surface disposal). */
  clearAll(): void {
    this._flashTimers.clearAll();
    this._diceTimers.clearAll();
  }
}
