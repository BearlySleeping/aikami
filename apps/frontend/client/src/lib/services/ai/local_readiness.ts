// apps/frontend/client/src/lib/services/ai/local_readiness.ts
//
// Readiness for the on-device text engine, tracked PER MODEL.
//
// The defect this exists to prevent (issue #382 P0 "readiness-aware local
// execution"): the pool's sidecar probe only asked `/models` whether it
// answered. A 200 proved a process was listening, not that the model the caller
// asked for was loaded, present, or able to generate. A loaded-and-ready engine
// that cannot serve `qwen3-4b` was still treated as the preferred route, so
// every local-first call paid a cold load plus a failed generation before
// falling back — the exact latency the local path exists to remove.
//
// Readiness here is therefore MODEL-SPECIFIC and is only claimed from evidence:
//
//   - `served(modelIds)` — the engine's own model list. Proof that a listed
//     model can be generated. A model absent from the list is NOT ready.
//   - `generated(model)` — a successful generation for that model. Stronger
//     than a listing, because it is the outcome we actually depend on.
//   - `unavailable(reason)` — the engine is not usable; local-first is skipped
//     until the next probe says otherwise.
//
// A probe that only proves liveness leaves the state `unknown`, which routes to
// the gateway — the honest answer when readiness is unproven.
//
// Contract: issue #382 P0 "Unify routing, deadlines and fallback".

/** What is known about one model's readiness on the local engine. */
export type LocalReadiness = {
  /** `ready` needs evidence for the requested model; `unknown` does not. */
  readonly state: 'unknown' | 'ready' | 'unavailable';
  /** Models the engine reported it can serve, from its own model list. */
  readonly servedModelIds: readonly string[];
  /** Models a successful generation has confirmed, keyed by model id. */
  readonly confirmedModelIds: readonly string[];
  /** Why the engine is unavailable, when it is. */
  readonly reason?: string;
  /** Epoch ms of the most recent evidence. */
  readonly checkedAt?: number;
};

/** Mutable readiness controller owned by the local task-pool service. */
export type LocalReadinessController = {
  /** Current readiness snapshot. */
  readonly current: LocalReadiness;
  /** Records the engine's served-model list from a successful probe. */
  served(modelIds: readonly string[]): void;
  /** Records that a generation succeeded for `model`. */
  generated(model: string): void;
  /** Records that the engine cannot serve requests, with a reason. */
  unavailable(reason: string): void;
  /** Clears all evidence, e.g. after the engine unloads. */
  reset(): void;
  /**
   * Whether local-first may attempt `model` now.
   *
   * `undefined`/empty `model` means "whatever the engine serves" — used by the
   * managed in-browser worker, which has exactly one bundle and no model list.
   */
  canServe(model?: string): boolean;
};

/** True when a model id matches a served/confirmed id, tolerating path prefixes. */
const matchesModel = (candidate: string, wanted: string): boolean => {
  const left = candidate.trim().toLowerCase();
  const right = wanted.trim().toLowerCase();
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
};

/** Applies the same readiness and model matching rules to every local decision. */
export const canServeLocalModel = (options: {
  readiness: LocalReadiness;
  model?: string;
}): boolean => {
  const { readiness, model } = options;
  if (readiness.state === 'unavailable') {
    return false;
  }
  if (model === undefined || model.trim().length === 0) {
    // No model was named and nothing has failed: the engine is still
    // allowed one attempt, which is what establishes evidence either way.
    return true;
  }
  if (readiness.state === 'unknown') {
    // A liveness-only probe is not proof for an unnamed-model engine.
    return readiness.servedModelIds.length === 0;
  }
  return (
    readiness.confirmedModelIds.some((id) => matchesModel(id, model)) ||
    readiness.servedModelIds.some((id) => matchesModel(id, model))
  );
};

/** Creates the model-specific local readiness controller. */
export const createLocalReadinessController = (): LocalReadinessController => {
  let state: LocalReadiness = { state: 'unknown', servedModelIds: [], confirmedModelIds: [] };

  return {
    get current(): LocalReadiness {
      return state;
    },

    served(modelIds) {
      state = {
        state: modelIds.length === 0 ? 'unknown' : 'ready',
        servedModelIds: [...modelIds],
        confirmedModelIds: state.confirmedModelIds,
        checkedAt: Date.now(),
      };
    },

    generated(model) {
      const confirmed = state.confirmedModelIds.includes(model)
        ? state.confirmedModelIds
        : [...state.confirmedModelIds, model];
      state = { ...state, state: 'ready', confirmedModelIds: confirmed, checkedAt: Date.now() };
    },

    unavailable(reason) {
      state = {
        state: 'unavailable',
        servedModelIds: state.servedModelIds,
        confirmedModelIds: state.confirmedModelIds,
        reason,
        checkedAt: Date.now(),
      };
    },

    reset() {
      state = { state: 'unknown', servedModelIds: [], confirmedModelIds: [] };
    },

    canServe(model) {
      return canServeLocalModel({ readiness: state, model });
    },
  };
};
