// apps/frontend/client/src/lib/views/dev/combat_enhancements/combat_enhancements_view_model.svelte.ts
// C-234 Dev Sandbox — Combat Enhancements (Dice & Initiative)

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services/base';
import {
  type ActionEconomy,
  type DiceNotation,
  type EnrichedCombatLogEntry,
  fullActionEconomy,
  type InitiativeEntry,
  type QueuedRoll,
  type TurnState,
} from '$views/combat/types/combat_enhancements.ts';
import { parseDamageFromLog, parseDiceFromLog } from '$views/combat/utils/dice_notation.ts';

const LOG_PRESETS = [
  'Player rolls 18 for 12 slashing damage',
  'Player rolls 5 — Miss!',
  'Critical hit! Player deals 30 piercing damage!',
  'Enemy attacks with fire breath for 22 fire damage',
  'Player rolls 20 with advantage for 15 radiant damage',
] as const;

const EXAMPLE_LOGS = [
  'Player rolls 18 (+5 = 23) for 12 slashing damage',
  'Goblin rolls 5 (+2 = 7) — Miss!',
  'Critical hit! Player rolls 20 for 30 piercing damage',
  'Enemy casts fire breath — 22 fire damage',
] as const;

const enrichLogEntry = (text: string): EnrichedCombatLogEntry => {
  const dice = parseDiceFromLog(text);
  const damage = parseDamageFromLog(text);
  return {
    rawText: text,
    isPlainText: !dice,
    ...dice,
    ...damage,
  };
};

/** State and interactions for the isolated combat-enhancements sandbox. */
export type CombatEnhancementsViewModelInterface = BaseDevViewModelInterface & {
  readonly queuedRolls: QueuedRoll[];
  readonly isRolling: boolean;
  readonly initiativeEntries: InitiativeEntry[];
  readonly turnState: TurnState | null;
  readonly actionEconomy: ActionEconomy;
  readonly testLogText: string;
  readonly testLogEntry: EnrichedCombatLogEntry;
  readonly logPresets: ReadonlyArray<{ readonly text: string; readonly label: string }>;
  readonly exampleEntries: readonly EnrichedCombatLogEntry[];
  readonly isEndTurnDisabled: boolean;
  queueRoll(options: { notation: DiceNotation; label: string }): void;
  removeQueuedRoll(id: string): void;
  resolveAllRolls(): void;
  cycleTurn(): void;
  toggleDefeated(): void;
  toggleActionAvailability(): void;
  toggleQuickActionAvailability(): void;
  toggleReactionAvailability(): void;
  setTestLogText(text: string): void;
  handleTestLogInput(event: Event): void;
};

export type CombatEnhancementsViewModelOptions = BaseDevViewModelOptions;

class CombatEnhancementsViewModel
  extends BaseDevViewModel<CombatEnhancementsViewModelOptions>
  implements CombatEnhancementsViewModelInterface
{
  queuedRolls: QueuedRoll[] = $state([]);
  isRolling = $state(false);
  initiativeEntries: InitiativeEntry[] = $state([
    {
      entityId: 1,
      name: 'Player',
      initiative: 18,
      currentHp: 75,
      maxHp: 100,
      isCurrentTurn: true,
      isDefeated: false,
      statusEffectIds: [],
    },
    {
      entityId: 2,
      name: 'Goblin',
      initiative: 14,
      currentHp: 42,
      maxHp: 80,
      isCurrentTurn: false,
      isDefeated: false,
      statusEffectIds: [],
    },
    {
      entityId: 3,
      name: 'Skeleton',
      initiative: 10,
      currentHp: 0,
      maxHp: 50,
      isCurrentTurn: false,
      isDefeated: true,
      statusEffectIds: [],
    },
  ]);
  turnState: TurnState | null = $state({
    currentEntityId: 1,
    currentEntityName: 'Player',
    isPlayerTurn: true,
    actionEconomy: fullActionEconomy(),
    turnNumber: 3,
  });
  testLogText = $state('Player rolls 18 (+5 = 23) to hit for 12 slashing damage');
  readonly logPresets = LOG_PRESETS.map((text) => ({
    text,
    label: `${text.split(' ').slice(0, 3).join(' ')}…`,
  }));
  readonly exampleEntries = EXAMPLE_LOGS.map(enrichLogEntry);
  readonly isEndTurnDisabled = false;

  private _rollCounter = 0;
  private _rollTimeout: ReturnType<typeof setTimeout> | undefined;

  get actionEconomy(): ActionEconomy {
    return this.turnState?.actionEconomy ?? fullActionEconomy();
  }

  get testLogEntry(): EnrichedCombatLogEntry {
    return enrichLogEntry(this.testLogText);
  }

  queueRoll(options: { notation: DiceNotation; label: string }): void {
    this._rollCounter += 1;
    this.queuedRolls = [
      ...this.queuedRolls,
      {
        id: `q-${this._rollCounter}`,
        notation: options.notation,
        label: options.label,
        timestamp: Date.now(),
      },
    ];
  }

  removeQueuedRoll(id: string): void {
    this.queuedRolls = this.queuedRolls.filter((roll) => roll.id !== id);
  }

  resolveAllRolls(): void {
    if (this.queuedRolls.length === 0) {
      return;
    }
    this.isRolling = true;
    this._rollTimeout = setTimeout(() => {
      this.queuedRolls = [];
      this.isRolling = false;
      this._rollTimeout = undefined;
    }, 1500);
  }

  cycleTurn(): void {
    if (!this.turnState) {
      return;
    }
    const nextId = this.turnState.currentEntityId === 1 ? 2 : 1;
    this.turnState = {
      currentEntityId: nextId,
      currentEntityName: nextId === 1 ? 'Player' : 'Goblin',
      isPlayerTurn: nextId === 1,
      actionEconomy: fullActionEconomy(),
      turnNumber: this.turnState.turnNumber + 1,
    };
    this.initiativeEntries = this.initiativeEntries.map((entry) => ({
      ...entry,
      isCurrentTurn: entry.entityId === nextId,
    }));
  }

  toggleDefeated(): void {
    this.initiativeEntries = this.initiativeEntries.map((entry) => {
      if (entry.entityId !== 2) {
        return entry;
      }
      return {
        ...entry,
        isDefeated: !entry.isDefeated,
        currentHp: entry.isDefeated ? 42 : 0,
      };
    });
  }

  toggleActionAvailability(): void {
    this._toggleActionEconomy('actionAvailable');
  }

  toggleQuickActionAvailability(): void {
    this._toggleActionEconomy('quickActionAvailable');
  }

  toggleReactionAvailability(): void {
    this._toggleActionEconomy('reactionAvailable');
  }

  setTestLogText(text: string): void {
    this.testLogText = text;
  }

  handleTestLogInput(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) {
      return;
    }
    this.setTestLogText(event.currentTarget.value);
  }

  override async dispose(): Promise<void> {
    if (this._rollTimeout !== undefined) {
      clearTimeout(this._rollTimeout);
      this._rollTimeout = undefined;
    }
    this.isRolling = false;
    await super.dispose();
  }

  private _toggleActionEconomy(
    type: 'actionAvailable' | 'quickActionAvailable' | 'reactionAvailable',
  ): void {
    if (!this.turnState) {
      return;
    }
    this.turnState = {
      ...this.turnState,
      actionEconomy: {
        ...this.turnState.actionEconomy,
        [type]: !this.turnState.actionEconomy[type],
        ...(type === 'quickActionAvailable'
          ? { bonusActionAvailable: !this.turnState.actionEconomy.quickActionAvailable }
          : {}),
      },
    };
  }
}

/** Creates an isolated combat-enhancements sandbox ViewModel. */
export const createCombatEnhancementsViewModel = (
  options: CombatEnhancementsViewModelOptions,
): CombatEnhancementsViewModelInterface => CombatEnhancementsViewModel.create(options);
