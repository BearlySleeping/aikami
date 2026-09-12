// scripts/src/lib/herdr/services/audio.ts
//
// The `audio` dev service (C-511) — the ACE-Step text-to-audio engine.
//
// Defined here rather than inline in `session.ts` because that file is
// size-ratcheted at 2268 lines in guard_source_file_size_baseline.json and
// baseline growth is rejected against the trusted base revision.
//
// Audio is OPT-IN tooling: it is registered in KNOWN_SERVICES so
// `bun run herdr:start audio` works, but it is deliberately absent from
// ALL_SERVICES (`all`), DEFAULT_MODALITIES and the shipped COMPOSE_PROFILES —
// a multi-gigabyte Python engine must never start unasked.
//
// Identity probe: ACE-Step's own server (`infer-api.py`) answers
// `GET /health` with `{"status":"healthy"}`. sd-server 404s there and
// sherpa-onnx answers with the plain text "ok", so the three engines on
// distinct ports remain distinguishable.

import { resolve } from 'node:path';
import { PORTS } from '@aikami/constants';
import type { ServiceDef } from '../session.ts';
import { type EngineProbeFactory, isRecord } from './engine_probe.ts';

/**
 * Verifies that ACE-Step (and not another engine) answers on `port`.
 *
 * Exported so the probe can be unit-tested without a live engine.
 */
export const verifyAceStepHealth = async (port: number): Promise<boolean> => {
  const res = await fetch(`http://127.0.0.1:${port}/health`, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as unknown;
  return isRecord(data) && data.status === 'healthy';
};

/**
 * Builds the `audio` service definition.
 *
 * @param engineProbe — session.ts's engine-probe factory. Passed in rather
 *        than imported so this module never forms an import cycle with the
 *        ratcheted session module.
 */
export const createAudioServiceDef = (
  engineProbe: EngineProbeFactory,
): Record<'audio', ServiceDef> => ({
  audio: {
    name: 'audio',
    command: () => 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/audio'),
    readyPort: (mode) => PORTS[mode].audio,
    scope: 'run',
    probe: engineProbe('audio', verifyAceStepHealth),
  },
});
