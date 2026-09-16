// apps/frontend/client/src/lib/views/combat/combat_selection_controller.svelte.ts
//
// Direct-control selection controller for a combat surface (C-516 AC-7/AC-8/AC-9,
// extracted by C-525 R-1).
//
// Owns everything the player is picking — move destination, ability, legal
// target, forecast — as a PROJECTION of what the engine answered. It computes no
// mechanics: it asks, it remembers, and it forwards the player's choice as a cell
// or an id. The ViewModel only delegates and renders.
//
// Stale-safety: every preview round trip is correlated by `requestId` AND bound
// to the engine's `stateRevision`, so a late answer for a superseded selection is
// discarded instead of repainted.
//
// Contract: C-516 AC-7, AC-9; C-525 R-1

import { BASIC_COMBAT_ABILITIES, BASIC_MELEE_ABILITY_ID } from '@aikami/constants';
import type { EngineBridge } from '@aikami/frontend/engine';
import type { CombatCommand, CombatEngineKind, CombatPreviewQuery, GridPoint } from '@aikami/types';
import type { CombatAbilityOption, CombatSelectionState } from './types/combat_direct_control.ts';
import { IDLE_COMBAT_SELECTION } from './types/combat_direct_control.ts';

/** The authored combatant id the v2 kernel knows the player by. */
const PLAYER_COMBATANT_ID = 'player';

/**
 * The slice of the engine bridge this controller uses.
 *
 * Derived from the engine bridge so the ViewModel can pass its own bridge
 * directly — no assertion — and every `on(...)` handler receives the engine's
 * precisely typed payload.
 */
export type CombatSelectionBridge = Pick<EngineBridge, 'send' | 'on'>;

/** Everything the controller needs from its owner. */
export type CombatSelectionDeps = {
  bridge(): CombatSelectionBridge | undefined;
  /** The revision the engine last reported. */
  readRevision(): number;
  /** The encounter id the engine last reported. */
  readEncounterId(): string;
  /** The engine pinned on the running encounter. */
  readEngine(): CombatEngineKind;
  /** Whether an encounter is running. */
  isInCombat(): boolean;
  debug(event: string, data?: Record<string, unknown>): void;
};

/**
 * Legacy ids are numeric eids; v2 ids are authored combatant ids. Coercing an
 * authored id to a number hands the kernel `NaN` and rejects every attack, so
 * only a genuinely numeric id is converted.
 */
export const engineTargetId = (targetId: string): string | number => {
  const numeric = Number(targetId);
  return Number.isNaN(numeric) ? targetId : numeric;
};

export class CombatSelectionController {
  /** The selection the sidebar renders. */
  selection: CombatSelectionState = $state({ ...IDLE_COMBAT_SELECTION });

  private readonly _deps: CombatSelectionDeps;
  /** Monotonic preview correlation counter — never reused. */
  private _previewCounter = 0;

  constructor(deps: CombatSelectionDeps) {
    this._deps = deps;
  }

  /** Registers the selection listeners; returns one cleanup. */
  attach(): () => void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return () => {};
    }
    const removePreviewReady = bridge.on('COMBAT_PREVIEW_READY', (event) => {
      this._handlePreviewReady(event);
    });
    const removePlanRejected = bridge.on('COMBAT_PLAN_REJECTED', (event) => {
      this._handlePlanRejected(event);
    });
    const removeMoveRequested = bridge.on('COMBAT_MOVE_REQUESTED', (event) => {
      this.commitMoveToCell({ x: event.cellX, y: event.cellY });
    });
    return () => {
      removePreviewReady();
      removePlanRejected();
      removeMoveRequested();
    };
  }

  /**
   * The abilities the player may pick, from the production catalog.
   *
   * The catalog is the SAME object the engine resolves against, so the picker
   * can never offer an ability the kernel would reject as `abilityUnknown`.
   */
  get availableAbilities(): CombatAbilityOption[] {
    return Object.values(BASIC_COMBAT_ABILITIES).map((ability) => ({
      abilityId: ability.abilityId,
      name: ability.name,
      kind: ability.kind,
      actionCost: ability.actionCost,
      rangeCells: ability.rangeCells,
    }));
  }

  /** Whether a preview round trip is outstanding. */
  get isLoading(): boolean {
    return this.selection.status === 'loading';
  }

  /** Whether the player is picking a move destination. */
  get isMoveSelection(): boolean {
    return this.selection.mode === 'move';
  }

  get moveButtonClasses(): string {
    return this.isMoveSelection ? 'btn btn-active btn-sm flex-1' : 'btn btn-outline btn-sm flex-1';
  }

  get moveButtonLabel(): string {
    return this.isMoveSelection ? '🥾 Cancel move' : '🥾 Move';
  }

  get isMoveButtonDisabled(): boolean {
    return this.isLoading && !this.isMoveSelection;
  }

  /**
   * CSS classes for an ability picker button.
   *
   * Owned here so the sidebar renders presentation only: the selected ability is
   * highlighted, every other entry is outlined.
   */
  abilityButtonClasses(abilityId: string): string {
    return this.selection.selectedAbilityId === abilityId
      ? 'btn btn-primary btn-xs'
      : 'btn btn-outline btn-xs';
  }

  /** CSS classes for a legal-target picker button (same contract as above). */
  targetButtonClasses(targetId: string): string {
    return this.selection.selectedTargetId === targetId
      ? 'btn btn-warning btn-xs'
      : 'btn btn-outline btn-xs';
  }

  get forecastHitPercentage(): number | null {
    const hitChance = this.selection.forecast?.hitChance;
    return hitChance === undefined ? null : Math.round(hitChance * 100);
  }

  /** Whether the player is picking a target for the selected ability. */
  get isTargetSelection(): boolean {
    return this.selection.mode === 'target' && this.selection.selectedAbilityId !== null;
  }

  /** The engine rejection of the last selection round trip, if any. */
  get rejection(): string | null {
    return this.selection.rejection?.messageKey ?? null;
  }

  /**
   * Enters move selection and asks the engine for the reachable cells.
   *
   * The main thread learns that a canvas click is now a budgeted combat move
   * rather than explore locomotion (C-516 AC-8).
   */
  beginMoveSelection(): void {
    const bridge = this._deps.bridge();
    if (!this._deps.isInCombat() || bridge === undefined) {
      return;
    }
    bridge.send({ type: 'COMBAT_MOVE_MODE', active: true });
    this._requestPreview({
      mode: 'move',
      query: { kind: 'legalMoves', combatantId: PLAYER_COMBATANT_ID },
    });
  }

  /** Opens move selection, or cancels it when already active. */
  toggleMoveSelection(): void {
    if (this.isMoveSelection) {
      this.cancel();
      return;
    }
    this.beginMoveSelection();
  }

  /** Enters target selection for `abilityId` and asks for its legal targets. */
  beginAbilitySelection(abilityId: string): void {
    if (!this._deps.isInCombat() || this._deps.bridge() === undefined) {
      return;
    }
    this._requestPreview({
      mode: 'target',
      abilityId,
      query: { kind: 'legalTargets', combatantId: PLAYER_COMBATANT_ID, abilityId },
    });
  }

  /** Clears the current selection — cancels any outstanding preview. */
  cancel(): void {
    if (this.selection.mode === 'idle') {
      return;
    }
    this._deps.debug('selection:cancel', { mode: this.selection.mode });
    if (this.selection.mode === 'move') {
      this._deps.bridge()?.send({ type: 'COMBAT_MOVE_MODE', active: false });
    }
    this.selection = { ...IDLE_COMBAT_SELECTION, basedOnRevision: this._deps.readRevision() };
    this.syncHighlights();
  }

  /** Drops a selection bound to a revision the engine has moved past. */
  invalidateOnRevision(revision: number): void {
    if (this.selection.mode === 'move') {
      this._deps.bridge()?.send({ type: 'COMBAT_MOVE_MODE', active: false });
    }
    this.selection = { ...IDLE_COMBAT_SELECTION, basedOnRevision: revision };
    this.syncHighlights();
  }

  /** Forgets the selection (encounter start/end). */
  reset(): void {
    this.selection = { ...IDLE_COMBAT_SELECTION };
    this.syncHighlights();
  }

  /** Applies a rejected commit to the visible selection (R-5). */
  rejectCommand(reasonCode: string, messageKey: string): void {
    this.selection = {
      ...this.selection,
      status: 'rejected',
      requestId: null,
      forecast: null,
      rejection: { reasonCode, messageKey },
    };
  }

  /**
   * Mirrors the current selection's highlight cells to the engine (C-525 R-2).
   *
   * The tactical canvas is PixiJS owned by the engine's `GameWorld`; only the
   * reachable endpoints and legal target cells are projected. An empty selection
   * clears the overlay, so this is also the cancel path.
   */
  syncHighlights(): void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return;
    }
    bridge.send({
      type: 'COMBAT_SELECTION_HIGHLIGHTS',
      legalEndpoints: this.selection.legalEndpoints,
      legalTargetCells: this.selection.legalTargetCells,
    });
  }

  /**
   * Commits the current selection.
   *
   * A move commits the DESTINATION cell; an ability/attack commits the selected
   * target. Nothing mechanical is sent — only ids and cells.
   */
  commit(): void {
    const selection = this.selection;
    const bridge = this._deps.bridge();
    if (bridge === undefined || !this._deps.isInCombat()) {
      return;
    }
    if (selection.mode === 'move') {
      this._deps.debug('selection:commit-move-needs-cell');
      return;
    }
    if (selection.selectedTargetId === null) {
      return;
    }
    const isBasicAttack = selection.selectedAbilityId === null;
    bridge.send({
      type: 'COMBAT_ACTION',
      action: isBasicAttack ? 'ATTACK' : 'ABILITY',
      ...(selection.selectedAbilityId === null ? {} : { abilityId: selection.selectedAbilityId }),
      targetId: engineTargetId(selection.selectedTargetId),
      // Review F2: bind the commit to the revision the selection was built
      // against, so a delayed command is refused rather than resolved against
      // a state the player never saw.
      basedOnRevision: this._deps.readRevision(),
    });
    this.cancel();
  }

  /**
   * Picks a target for the current ability selection.
   *
   * The `legalTargets` answer carries only an *empty* forecast — it answers a
   * legality question — so picking a target also asks the engine to forecast the
   * exact command a commit would send (C-516 AC-7/AC-9).
   *
   * v2-only: the `action` query is part of the C-515 preview contract the v2
   * resolver answers. A legacy encounter would never answer it, so the request
   * is not sent and the panel stays absent rather than loading forever.
   */
  selectTarget(combatantId: string): void {
    if (this.selection.mode === 'idle') {
      return;
    }
    this.selection = { ...this.selection, selectedTargetId: combatantId };
    if (this._deps.readEngine() !== 'v2') {
      return;
    }
    const command = this._actionForecastCommand(combatantId);
    this._requestPreview({
      mode: this.selection.mode,
      query: { kind: 'action', combatantId: command.combatantId, command },
      preserveSelection: true,
    });
  }

  /** Selects an ability without waiting for a preview (`Defend`/basic attack). */
  selectAbility(abilityId: string | null): void {
    this.selection = {
      ...this.selection,
      selectedAbilityId: abilityId,
      mode: abilityId === null ? 'ability' : 'target',
      selectedTargetId: null,
      legalTargetIds: [],
      legalTargetCells: [],
      forecast: null,
      status: 'ready',
    };
    this.syncHighlights();
  }

  /**
   * Commits a budgeted move to `cell` (C-516 AC-8).
   *
   * Used by the canvas pointer: clicking a highlighted endpoint sends the cell,
   * and the engine rejects anything outside the reachable set without moving.
   */
  commitMoveToCell(cell: GridPoint): void {
    const bridge = this._deps.bridge();
    if (bridge === undefined || !this._deps.isInCombat()) {
      return;
    }
    if (!this.isMoveSelection) {
      this._deps.debug('selection:not-in-move-selection', { cell });
      return;
    }
    const isReachable = this.selection.legalEndpoints.some(
      (endpoint) => endpoint.x === cell.x && endpoint.y === cell.y,
    );
    if (!isReachable) {
      this._deps.debug('selection:cell-not-reachable', { cell });
      return;
    }
    bridge.send({
      type: 'COMBAT_MOVE',
      cellX: cell.x,
      cellY: cell.y,
      basedOnRevision: this._deps.readRevision(),
    });
    this.cancel();
  }

  /**
   * The kernel command a commit would send for `targetId`.
   *
   * Forecasting the committed command (not a similar one) is what makes the panel
   * honest: an `ATTACK` — no ability picked — is the `basic_melee` catalog entry,
   * the same id the engine's `DEFAULT_BASIC_ATTACK_ABILITY_ID` resolves.
   */
  private _actionForecastCommand(targetId: string): CombatCommand {
    return {
      kind: 'useAbility',
      combatantId: PLAYER_COMBATANT_ID,
      abilityId: this.selection.selectedAbilityId ?? BASIC_MELEE_ABILITY_ID,
      targetIds: [targetId],
    };
  }

  /**
   * Sends one preview request and remembers its correlation id.
   *
   * A new request supersedes the outstanding one: the reply for the old id is
   * discarded on arrival, so a slow answer can never repaint a newer selection.
   * `preserveSelection` is set by a follow-up query that REFINES the same
   * selection (`legalTargets` → `action` forecast).
   */
  private _requestPreview(options: {
    mode: CombatSelectionState['mode'];
    abilityId?: string;
    query: CombatPreviewQuery;
    preserveSelection?: boolean;
  }): void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return;
    }
    const revision = this._deps.readRevision();
    const requestId = `preview-${++this._previewCounter}`;
    this.selection =
      options.preserveSelection === true
        ? {
            ...this.selection,
            status: 'loading',
            requestId,
            basedOnRevision: revision,
            rejection: null,
          }
        : {
            ...IDLE_COMBAT_SELECTION,
            mode: options.mode,
            status: 'loading',
            requestId,
            basedOnRevision: revision,
            selectedAbilityId: options.abilityId ?? null,
          };
    bridge.send({
      type: 'COMBAT_PREVIEW_REQUESTED',
      requestId,
      encounterId: this._deps.readEncounterId(),
      basedOnRevision: revision,
      query: options.query,
    });
    // A new request replaces the highlighted set; a `preserveSelection`
    // refinement keeps the cells the player is already choosing from.
    this.syncHighlights();
  }

  /** Applies a `COMBAT_PREVIEW_READY` reply, discarding stale correlations. */
  private _handlePreviewReady(event: {
    requestId: string;
    forecast: CombatSelectionState['forecast'];
    legalEndpoints?: GridPoint[];
    legalTargetIds?: string[];
    legalTargetCells?: GridPoint[];
    movementCostTo?: Record<string, number>;
  }): void {
    if (event.requestId !== this.selection.requestId) {
      // A reply for a superseded request — never repaint the newer selection.
      return;
    }
    // `legalEndpoints` / `legalTargetIds` / `movementCostTo` are per query kind
    // (C-515): an `action` forecast answers with the numbers alone. Only a field
    // the engine actually sent may overwrite what the player is looking at —
    // otherwise asking for a forecast would erase the target list that produced
    // it.
    this.selection = {
      ...this.selection,
      status: 'ready',
      ...(event.legalEndpoints === undefined ? {} : { legalEndpoints: event.legalEndpoints }),
      ...(event.legalTargetIds === undefined ? {} : { legalTargetIds: event.legalTargetIds }),
      ...(event.legalTargetCells === undefined ? {} : { legalTargetCells: event.legalTargetCells }),
      ...(event.movementCostTo === undefined ? {} : { movementCostTo: event.movementCostTo }),
      forecast: event.forecast,
      rejection: null,
    };
    this.syncHighlights();
  }

  /** Applies a `COMBAT_PLAN_REJECTED` reply as a typed, visible rejection. */
  private _handlePlanRejected(event: {
    requestId: string;
    reasonCode: string;
    messageKey: string;
  }): void {
    if (event.requestId !== this.selection.requestId) {
      return;
    }
    // The rejection clears the forecast and reports the reason, but keeps the
    // endpoints/targets: a rejected *forecast* must not also throw away the legal
    // set the player is choosing from.
    this.selection = {
      ...this.selection,
      status: 'rejected',
      forecast: null,
      rejection: { reasonCode: event.reasonCode, messageKey: event.messageKey },
    };
    this.syncHighlights();
  }
}

/** Builds the selection controller for one combat surface. */
export const createCombatSelectionController = (
  deps: CombatSelectionDeps,
): CombatSelectionController => new CombatSelectionController(deps);
