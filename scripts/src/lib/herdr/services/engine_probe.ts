// scripts/src/lib/herdr/services/engine_probe.ts
//
// Identity probes for the shared local-stack engines (C-471 AC-2), extracted
// from `session.ts` so the C-511 audio service can live in its own module
// without growing the size-ratcheted session file.
//
// voice/image/text/audio are heavy singletons — there is exactly one container
// per machine regardless of checkout/run, so the "which instance" question
// reduces to "is the CORRECT application answering on the ready port" (e.g.
// sd-server and not ComfyUI, llama.cpp and not Ollama, ACE-Step and not
// sd-server). When the right app answers we adopt it as this run's instance
// and report the expected identity — the only identity a shared engine can
// carry.

import type { DevService } from '@aikami/constants';
import type { ProbeResult, ServiceDef, ServiceIdentity } from '../session.ts';

/** Resolves a service's ready port for the ambient mode (contract-offset aware). */
export type EnginePortResolver = (serviceKey: DevService) => number | undefined;

/** The engine-probe factory shape `session.ts` exposes. */
export type EngineProbeFactory = (
  serviceKey: DevService,
  verify: (port: number) => Promise<boolean> | boolean,
) => NonNullable<ServiceDef['probe']>;

/** True when a value is a plain (non-array) object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Builds an engine-probe factory bound to a port resolver.
 *
 * `resolvePort` is only invoked when the probe runs, never at module-init, so
 * a caller may pass a closure over bindings defined later in its own module.
 *
 * `verify` returns true when the correct application answers on the port.
 */
export const makeEngineProbe =
  (resolvePort: EnginePortResolver): EngineProbeFactory =>
  (serviceKey, verify) =>
  async (expectedIdentity: ServiceIdentity): Promise<ProbeResult> => {
    const port = resolvePort(serviceKey);
    if (port === undefined) {
      return { ready: false, reason: `${serviceKey} has no ready port defined` };
    }
    let ok = false;
    try {
      ok = await verify(port);
    } catch {
      ok = false;
    }
    return ok
      ? { ready: true, observedIdentity: expectedIdentity }
      : { ready: false, reason: `${serviceKey} engine did not answer on :${port}` };
  };
