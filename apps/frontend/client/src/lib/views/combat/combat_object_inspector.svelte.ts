// apps/frontend/client/src/lib/views/combat/combat_object_inspector.svelte.ts
//
// Authored-object inspector for a v2 combat surface (C-531 AC-1, AC-2, AC-4).
//
// A plain controller class — the ViewModel owns no inspection logic, it
// delegates and renders. The loop is: snapshot → list what the actor can
// actually do to each object (and WHY the rest is unavailable) → preview →
// CONFIRM. Nothing here sends a mechanical command except {@link
// CombatObjectInspector.confirm}, which is reachable only from an explicit
// player confirmation of a previewed action.
//
// The inspector never invents a mechanic: the affordance list comes from the
// engine's own registry (`getObjectAffordances` on the snapshot the engine
// returned), the preview comes from the engine's forecast, and the commit is an
// ordinary `COMBAT_INTERACT` command the kernel validates.
//
// Contract: C-531 AC-1, AC-2, AC-4

import type { CombatInteractCommand, EngineBridge } from '@aikami/frontend/engine';
import type { ActionForecast, CombatState, EnvironmentalForecastEffect } from '@aikami/types';

/** The slice of the engine bridge this controller uses. */
export type CombatObjectInspectorBridge = Pick<EngineBridge, 'send' | 'on'>;

/** One authored object as the inspector presents it. */
export type InspectedObject = {
  objectId: string;
  definitionId: string;
  name: string;
  cell: { x: number; y: number };
  state: 'intact' | 'broken';
  ignited: boolean;
  cover: 'none' | 'half' | 'full';
  durability: number;
  affordances: Array<{
    affordanceId: string;
    name: string;
    actionCost: 'action' | 'quick' | 'reaction' | 'free';
    available: boolean;
    /** Stable i18n key for why the action is unavailable, or `null`. */
    unavailableMessageKey: string | null;
  }>;
};

/** The previewed consequence of one chosen action. */
export type InspectedPreview = {
  objectId: string;
  affordanceId: string;
  actionCost: ActionForecast['actionCost'];
  checkOutcome: ActionForecast['checkOutcome'] | null;
  effects: EnvironmentalForecastEffect[];
  impactCells: Array<{ x: number; y: number }>;
  warnings: string[];
};

export type CombatObjectInspectorStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'previewed'
  | 'committed'
  | 'rejected';

/** Everything the controller needs from its owner. */
export type CombatObjectInspectorDeps = {
  /** The live bridge, or `undefined` before the world exists. */
  bridge(): CombatObjectInspectorBridge | undefined;
  /** The current combat revision a command must be bound to. */
  readRevision(): number;
  /** The running encounter id. */
  readEncounterId(): string;
  /** The combatant whose turn it is. */
  readActorId(): string;
  /** How long to wait for a snapshot / preview before a typed rejection. */
  replyDeadlineMs?: number;
  /** Optional diagnostic sink. */
  debug?(event: string, data?: Record<string, unknown>): void;
};

const DEFAULT_REPLY_DEADLINE_MS = 4000;

/** Derives the inspector rows from an engine state snapshot. */
export const inspectedObjectsFromState = (state: CombatState): InspectedObject[] => {
  const rows: InspectedObject[] = [];
  const objectIds = Object.keys(state.environment.objects).sort();
  for (const objectId of objectIds) {
    const object = state.environment.objects[objectId];
    const definition = state.environmentBundle.objectDefinitions[object.definitionId];
    if (definition === undefined) {
      continue;
    }
    rows.push({
      objectId,
      definitionId: object.definitionId,
      name: definition.name,
      cell: { x: object.position.x, y: object.position.y },
      state: object.state,
      ignited: object.ignited,
      cover: object.cover,
      durability: object.durability,
      // The affordance list is the engine's own answer: an affordance the
      // object no longer exposes is absent, and one that is present but not
      // usable carries the reason the kernel would reject with.
      affordances: object.affordanceIds
        .filter((affordanceId) => definition.affordanceIds.includes(affordanceId))
        .map((affordanceId) => {
          const affordance = state.environmentBundle.affordances[affordanceId];
          return {
            affordanceId,
            name: affordance?.name ?? affordanceId,
            actionCost: affordance?.actionCost ?? 'action',
            available: affordance !== undefined && object.state === 'intact',
            unavailableMessageKey:
              affordance === undefined
                ? 'combat.invalid.affordance_unknown'
                : object.state === 'broken'
                  ? 'combat.invalid.object_destroyed'
                  : null,
          };
        })
        .sort((a, b) => (a.affordanceId < b.affordanceId ? -1 : 1)),
    });
  }
  return rows;
};

/** The command one previewed/confirmed action sends. */
export const inspectedCommand = (options: {
  actorId: string;
  objectId: string;
  affordanceId: string;
  targetObjectId?: string | null;
}): CombatInteractCommand => ({
  type: 'COMBAT_INTERACT',
  objectId: options.objectId,
  affordanceId: options.affordanceId,
  targetObjectId: options.targetObjectId ?? null,
});

/**
 * The authored-object inspector.
 *
 * State is deliberately plain (not `$state`): the ViewModel mirrors it into its
 * own runes, so this class stays unit-testable without a Svelte runtime.
 */
export class CombatObjectInspector {
  private readonly _deps: CombatObjectInspectorDeps;
  private readonly _replyDeadlineMs: number;
  private _requestCounter = 0;
  private _pendingSnapshotId: string | null = null;
  private _pendingPreviewId: string | null = null;
  /**
   * The state revision the outstanding preview was answered against.
   *
   * This — not the `status` flag — is what decides whether a confirmation is
   * still valid: a turn-change re-read that lands on the SAME revision has not
   * changed the plan, so it must not disarm the player's Confirm button.
   */
  private _previewRevision: number | null = null;

  /** Current rows, in stable object-id order. */
  objects: InspectedObject[] = [];
  /** Current status of the inspection loop. */
  status: CombatObjectInspectorStatus = 'idle';
  /** The object the player opened, or `null`. */
  selectedObjectId: string | null = null;
  /** The action the player chose, or `null`. */
  selectedAffordanceId: string | null = null;
  /** The engine's forecast for the chosen action, or `null`. */
  preview: InspectedPreview | null = null;
  /** Stable i18n key for the last rejection, or `null`. */
  rejectionKey: string | null = null;

  constructor(deps: CombatObjectInspectorDeps) {
    this._deps = deps;
    this._replyDeadlineMs = deps.replyDeadlineMs ?? DEFAULT_REPLY_DEADLINE_MS;
  }

  /** Whether the inspector has anything to show. */
  get hasObjects(): boolean {
    return this.objects.length > 0;
  }

  /**
   * Asks the engine for a state snapshot.
   *
   * Nothing is inspected from a locally cached state: the rows are derived from
   * the state the ENGINE returns, so the availability the player sees is the
   * availability the kernel will enforce.
   */
  refresh(): void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return;
    }
    const requestId = `${this._deps.readEncounterId()}:objects:${++this._requestCounter}`;
    this._pendingSnapshotId = requestId;
    this.status = 'loading';
    bridge.send({
      type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
      requestId,
      encounterId: this._deps.readEncounterId(),
    });
  }

  /** Handles the engine's answer to {@link refresh}. */
  handleStateSnapshot(event: { requestId: string; state: CombatState }): void {
    if (event.requestId !== this._pendingSnapshotId) {
      return;
    }
    this._pendingSnapshotId = null;
    if (event.state.encounterId !== this._deps.readEncounterId()) {
      return;
    }
    this.objects = inspectedObjectsFromState(event.state);
    // A re-read only invalidates an outstanding plan when the state actually
    // moved. Unconditionally resetting to `ready` here disarmed the Confirm
    // button on every turn-change refresh, so a player who had previewed an
    // action saw their confirmation silently refused (C-531).
    if (
      this.preview !== null &&
      this._previewRevision !== null &&
      this._deps.readRevision() !== this._previewRevision
    ) {
      this.preview = null;
      this.selectedAffordanceId = null;
      this._previewRevision = null;
      this.status = 'ready';
      return;
    }
    this.status = this.preview === null ? 'ready' : 'previewed';
  }

  /** Opens one object; the affordance list is already derived from the engine's state. */
  selectObject(objectId: string): void {
    this.selectedObjectId = objectId;
    this.selectedAffordanceId = null;
    this.preview = null;
    this._previewRevision = null;
    this.rejectionKey = null;
  }

  /**
   * Previews one action without committing it.
   *
   * A preview consumes no resources and rolls no dice — it is the engine's own
   * non-mutating forecast for the command that would be sent.
   */
  previewAction(affordanceId: string): void {
    const objectId = this.selectedObjectId;
    const bridge = this._deps.bridge();
    if (objectId === null || bridge === undefined) {
      return;
    }
    const row = this.objects.find((object) => object.objectId === objectId);
    const affordance = row?.affordances.find((entry) => entry.affordanceId === affordanceId);
    if (row === undefined || affordance === undefined) {
      return;
    }
    this.selectedAffordanceId = affordanceId;
    this._previewRevision = this._deps.readRevision();
    if (!affordance.available) {
      this.preview = null;
      this._previewRevision = null;
      this.rejectionKey = affordance.unavailableMessageKey;
      this.status = 'rejected';
      return;
    }
    const requestId = `${this._deps.readEncounterId()}:preview:${++this._requestCounter}`;
    this._pendingPreviewId = requestId;
    bridge.send({
      type: 'COMBAT_PREVIEW_REQUESTED',
      requestId,
      encounterId: this._deps.readEncounterId(),
      basedOnRevision: this._deps.readRevision(),
      query: {
        kind: 'action',
        combatantId: this._deps.readActorId(),
        command: {
          kind: 'interactWithObject',
          combatantId: this._deps.readActorId(),
          objectId,
          affordanceId,
          targetObjectId: null,
        },
      },
    });
  }

  /** Handles the engine's answer to {@link previewAction}. */
  handlePreviewReady(event: {
    requestId: string;
    forecast?: ActionForecast;
    reasonCode?: string;
    messageKey?: string;
  }): void {
    if (event.requestId !== this._pendingPreviewId) {
      return;
    }
    this._pendingPreviewId = null;
    const objectId = this.selectedObjectId;
    const affordanceId = this.selectedAffordanceId;
    if (objectId === null || affordanceId === null) {
      return;
    }
    if (event.forecast === undefined) {
      this.preview = null;
      this._previewRevision = null;
      this.rejectionKey = event.messageKey ?? 'combat.invalid.affordance_not_available';
      this.status = 'rejected';
      return;
    }
    this.preview = {
      objectId,
      affordanceId,
      actionCost: event.forecast.actionCost,
      checkOutcome: event.forecast.checkOutcome ?? null,
      effects: event.forecast.environmentalEffects ?? [],
      impactCells: event.forecast.impactCells ?? [],
      warnings: [...event.forecast.warnings],
    };
    this.status = 'previewed';
    this.rejectionKey = null;
  }

  /**
   * Commits the previewed action.
   *
   * Reachable only from an explicit player confirmation, and bound to the
   * revision the preview was answered against: a materially changed plan
   * requires a fresh preview, so a stale confirmation is refused here rather
   * than resolved against newer state. The KERNEL still re-validates the
   * command against its own revision — this guard only keeps the player from
   * confirming a plan the engine has already invalidated.
   */
  confirm(): boolean {
    const objectId = this.selectedObjectId;
    const affordanceId = this.selectedAffordanceId;
    const bridge = this._deps.bridge();
    if (objectId === null || affordanceId === null || bridge === undefined) {
      return false;
    }
    const stale =
      this._previewRevision !== null && this._deps.readRevision() !== this._previewRevision;
    if (this.preview === null || stale) {
      this.preview = null;
      this._previewRevision = null;
      this.rejectionKey = 'combat.invalid.affordance_not_available';
      this.status = 'rejected';
      return false;
    }
    bridge.send(
      inspectedCommand({
        actorId: this._deps.readActorId(),
        objectId,
        affordanceId,
      }),
    );
    this.status = 'committed';
    return true;
  }

  /** Cancels the outstanding interaction — nothing is committed. */
  cancel(): void {
    this._pendingPreviewId = null;
    this.selectedAffordanceId = null;
    this.preview = null;
    this._previewRevision = null;
    this.rejectionKey = null;
    this.status = this.objects.length > 0 ? 'ready' : 'idle';
  }

  /** The reply deadline, exposed so the ViewModel can arm its own timeout. */
  get replyDeadlineMs(): number {
    return this._replyDeadlineMs;
  }
}
