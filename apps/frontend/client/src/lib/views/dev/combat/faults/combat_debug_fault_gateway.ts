// apps/frontend/client/src/lib/views/dev/combat/faults/combat_debug_fault_gateway.ts
//
// Deterministic provider fault gateway for the combat debug workspace. It wraps
// the REAL intent capability so fault modes exercise the actual controller
// fallback/cancellation path — it never bypasses the controller and never
// commits a substitute outcome directly.
//
// `real` delegates to production. `disabled` and the simulated failures return
// typed failures the controller already understands. Simulated modes are
// reproducible and always labelled in the UI; they must never be persisted into
// normal AI preferences.
//
// Contract: combat debug workspace (execution prompt §6)

import type { CombatState, IntentInterpreterResult } from '@aikami/types';
import type { CombatDebugFaultMode } from '../types/combat_debug_types.ts';

/** The intent request shape this gateway accepts (a subset of production). */
export type CombatDebugIntentRequest = {
  readonly requestId: string;
  readonly intentId: string;
  readonly encounterId: string;
  readonly actorId: string;
  readonly basedOnRevision: number;
  readonly text: string;
  readonly state: CombatState;
};

/** The intent capability shape this gateway wraps (a subset of production). */
export type CombatDebugIntentDelegate = {
  interpretWithFallback(request: CombatDebugIntentRequest): Promise<IntentInterpreterResult>;
  cancel(requestId: string): void;
};

/** A fault gateway that also records which requests it short-circuited. */
export type CombatDebugFaultGateway = {
  readonly mode: CombatDebugFaultMode;
  /** True when this mode makes any real provider call. */
  readonly usesProvider: boolean;
  interpretWithFallback(request: CombatDebugIntentRequest): Promise<IntentInterpreterResult>;
  cancel(requestId: string): void;
  /** Request ids short-circuited by a simulated fault (diagnostics). */
  readonly shortCircuitedRequestIds: readonly string[];
};

/** Options for building a gateway over a real or absent delegate. */
export type CombatDebugFaultGatewayOptions = {
  readonly mode: CombatDebugFaultMode;
  /** Present when a real provider path is available. */
  readonly delegate: CombatDebugIntentDelegate | undefined;
  /** Timeout used by the `timeout` fault mode. */
  readonly timeoutMs?: number;
  /** Delay used by the `delayed-stale` fault mode. */
  readonly delayMs?: number;
};

const DEFAULT_TIMEOUT_MS = 50;
const DEFAULT_DELAY_MS = 800;

/**
 * Builds a deterministic fault gateway. `real` requires a delegate; every other
 * mode is provider-free. `malformed` simulates a structurally unusable reply by
 * returning a typed refusal the controller treats as unparseable.
 */
export const createCombatDebugFaultGateway = (
  options: CombatDebugFaultGatewayOptions,
): CombatDebugFaultGateway => {
  const shortCircuited: string[] = [];
  const usesProvider = options.mode === 'real';

  return {
    mode: options.mode,
    usesProvider,
    shortCircuitedRequestIds: shortCircuited,

    async interpretWithFallback(
      request: CombatDebugIntentRequest,
    ): Promise<IntentInterpreterResult> {
      switch (options.mode) {
        case 'real': {
          if (!options.delegate) {
            shortCircuited.push(request.requestId);
            return { ok: false, reason: 'refused' };
          }
          return options.delegate.interpretWithFallback(request);
        }
        case 'structured-success': {
          // The deterministic parser half of the production capability is the
          // controller's own fallback; a disabled gateway exercises it without
          // a provider. There is no separate success fixture to fake here — the
          // controller's deterministic path is the success case.
          shortCircuited.push(request.requestId);
          return { ok: false, reason: 'refused' };
        }
        case 'disabled':
        case 'unavailable': {
          shortCircuited.push(request.requestId);
          return { ok: false, reason: 'refused' };
        }
        case 'timeout': {
          shortCircuited.push(request.requestId);
          await delay(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
          return { ok: false, reason: 'unparseable' };
        }
        case 'malformed': {
          shortCircuited.push(request.requestId);
          return { ok: false, reason: 'unparseable' };
        }
        case 'delayed-stale': {
          shortCircuited.push(request.requestId);
          await delay(options.delayMs ?? DEFAULT_DELAY_MS);
          return { ok: false, reason: 'unparseable' };
        }
        default: {
          shortCircuited.push(request.requestId);
          return { ok: false, reason: 'refused' };
        }
      }
    },

    cancel(requestId: string): void {
      options.delegate?.cancel(requestId);
    },
  };
};

/** Promise delay; no-op in a non-timing test environment. */
const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};
