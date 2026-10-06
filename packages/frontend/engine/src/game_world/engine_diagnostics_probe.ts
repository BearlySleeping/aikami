// packages/frontend/engine/src/game_world/engine_diagnostics_probe.ts
//
// The engine's read-only diagnostics surface for E2E/visual tooling.
//
// Three related questions — is this an E2E run, is this a visual-screenshot
// run, and what does the engine currently look like from the outside — were
// three separate methods on the facade, each a few lines of `this`. Grouped
// here they are one responsibility: publishing state for tooling, with the
// facade reduced to a single injected probe.

import {
  type EngineStateSnapshot,
  exposeEngineState,
  isE2ETestMode,
  isVisualScreenshotMode,
} from './diagnostics.ts';

/** The engine state the probe publishes. */
export type ProbeState = EngineStateSnapshot;

/** What the facade hands over; nothing here mutates engine state. */
export type EngineDiagnosticsProbeDeps = {
  /** Reads the current values at call time. */
  readState: () => ProbeState;
};

/** Read-only view of engine state for E2E and visual tooling. */
export type EngineDiagnosticsProbe = {
  isE2ETestMode: () => boolean;
  isVisualScreenshotMode: () => boolean;
  /** Publishes the current state where Playwright can await it. */
  exposeState: () => void;
};

export const createEngineDiagnosticsProbe = (
  deps: EngineDiagnosticsProbeDeps,
): EngineDiagnosticsProbe => ({
  isE2ETestMode,
  isVisualScreenshotMode,
  exposeState: () => {
    exposeEngineState(deps.readState());
  },
});
