// packages/frontend/ai-gateway/src/lib/reasoning_control.ts
//
// The reasoning-channel control, and the transport fact it depends on.
//
// Extracted from `text_adapter_openai_compatible.ts` because it is a distinct
// responsibility with a distinct failure mode: turning a task's semantic
// preference into the one request field a specific provider ACTUALLY honours on
// a specific transport. Everything else the adapter does either moves bytes or
// interprets bytes; this decides whether to add a field at all.
//
// The central hazard this module exists to make impossible: the control is a
// property of the (provider, SURFACE) pair, not of the provider alone.
// `resolveChatSurface` and `resolveChatUrl` both derive from the one provider
// branch here, so a reroute cannot leave them disagreeing — and
// `buildReasoningParams` drops a control whose measured surface is not the one
// being used, rather than sending a field the provider will accept with a 200
// and ignore.
// Contract: issue #382, C-401 call 2

import type { AiModeResolution } from '@aikami/types';

/**
 * Which transport a resolution will actually be sent over.
 *
 * Ollama speaks a native chat API; every other provider here is reached through
 * OpenAI's compatible surface. That is a property of the provider id today, and
 * the honest way to keep it honest is for one function to decide and for
 * everything else to ask.
 */
export type TextApiSurface = 'ollama-native' | 'openai-compatible';

/**
 * The measured (provider, surface) pairing that can be asked for no reasoning,
 * and the spelling that works on it.
 *
 * Mirrors `ProviderDescriptor.reasoningControl` in @aikami/constants; declared
 * here so the gateway package keeps no dependency on the client that owns the
 * provider registry. The two are structurally identical string unions, so the
 * client's values pass through unchanged.
 */
export type ReasoningControl = 'ollama-native-think' | 'openai-compat-reasoning-effort';

/**
 * The single source of truth for which transport a resolution uses.
 *
 * `resolveChatUrl` branches on this, so the URL and the reasoning spelling can
 * never disagree about the surface.
 */
export const resolveChatSurface = (resolution: AiModeResolution): TextApiSurface =>
  resolution.provider === 'ollama' ? 'ollama-native' : 'openai-compatible';

/**
 * Translates a call's reasoning preference into the one field this provider
 * honours on the surface it is about to be sent over.
 *
 * The two measured spellings are not interchangeable and are not accepted on
 * each other's endpoint (Ollama 0.34.3, issue #382): native `/api/chat`
 * honours `think: false` and ignores `reasoning_effort`; `/v1/chat/completions`
 * honours `reasoning_effort: "none"` and ignores `think`. `reasoning_effort` is
 * not a "lower it" dial either — `"minimal"` leaves reasoning fully on.
 *
 * Returns `{}` in every other case, and each case is a deliberate no-op rather
 * than a guess:
 *
 *   - the call did not ask. Absence is the point: sending `think: true` is NOT
 *     semantically equivalent to leaving the provider alone, so a task with no
 *     preference must produce no field at all;
 *   - the provider declares no control. An unmeasured capability is not a
 *     capability, so the body stays byte-identical to the pre-change one;
 *   - the declared control was measured on a DIFFERENT surface. A provider
 *     later rerouted onto an unmeasured surface keeps the old body rather than
 *     a field that returns 200 and does nothing — the exact failure this
 *     measurement exists to prevent.
 *
 * In none of these does the call fail. A task that cannot have its preference
 * honoured simply degrades on its own deadline, which is the behaviour it
 * already had.
 */
export const buildReasoningParams = (options: {
  resolution: AiModeResolution;
  /** Which control a provider declares, if any. Absent means "none declared". */
  getReasoningControl?: (provider: string) => ReasoningControl | undefined;
}): Record<string, unknown> => {
  const { resolution, getReasoningControl } = options;
  if (resolution.reasoning !== 'none') {
    return {};
  }
  const control = getReasoningControl?.(resolution.provider);
  const surface = resolveChatSurface(resolution);
  if (control === 'ollama-native-think' && surface === 'ollama-native') {
    return { think: false };
  }
  if (control === 'openai-compat-reasoning-effort' && surface === 'openai-compatible') {
    return {
      // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
      reasoning_effort: 'none',
    };
  }
  return {};
};
