// packages/frontend/ai-gateway/src/lib/mode_resolver.ts
//
// Generic per-capability mode resolution from an AiGatewayModeConfig.
// Resolution is synchronous, in-memory, and computed once per gateway call
// at the dispatch boundary — never re-checked at call sites.
// Contract: C-320 AC-4 (service guard)

import type { AiGatewayModeConfig, AiModeResolution } from '@aikami/types';
import { createAiGatewayError } from './errors.ts';
import type { AiModeResolver } from './gateway_types.ts';

/**
 * Creates a mode resolver backed by a config provider.
 *
 * - Missing capability config → `not_configured`.
 * - `service` mode selected while `serviceActivated` is false →
 *   `mode_unavailable` (never a crash or silent fallback).
 */
export const createModeResolver = (options: {
  getConfig: () => AiGatewayModeConfig;
}): AiModeResolver => {
  const { getConfig } = options;

  return ({ capability, model }): AiModeResolution => {
    const config = getConfig();
    const entry = config[capability];

    if (!entry) {
      throw createAiGatewayError({
        code: 'not_configured',
        capability,
        mode: 'offline',
        message: `No ${capability} provider configured`,
      });
    }

    if (entry.mode === 'service' && config.serviceActivated !== true) {
      throw createAiGatewayError({
        code: 'mode_unavailable',
        capability,
        mode: 'service',
        provider: entry.provider,
        message: `Service mode is not activated for capability "${capability}"`,
      });
    }

    return {
      capability,
      mode: entry.mode,
      provider: entry.provider,
      endpoint: entry.endpoint,
      model: model ?? entry.model,
    };
  };
};
