/**
 * Bash Timeout Normalizer — enforces seconds-only convention for Bash tool timeouts
 * and injects non-interactive environment guards.
 *
 * Pi's built-in Bash tool interprets `timeout` as SECONDS. However, the model is
 * frequently trained on millisecond-based APIs and may pass values like 120000
 * (intending 120 s) — which the Bash tool interprets as 120,000 seconds (~33 hours).
 *
 * This extension intercepts `tool_call` events for Bash and:
 *   1. Normalises timeout values that are clearly in milliseconds (≥ 1000) down to seconds.
 *   2. Caps timeouts at a safe maximum (default: 600 s = 10 min).
 *   3. Injects CI=true, FORCE_COLOR=1, GIT_TERMINAL_PROMPT=0 into every command so
 *      CLI tools never hang waiting for interactive input (TTY prompts, colour queries, etc.).
 *
 * Heuristic: timeout ≥ 1000 → divide by 1000 (no legitimate bash timeout needs
 * 1000+ seconds / ~17 minutes).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isToolCallEventType } from '@earendil-works/pi-coding-agent';

/** Maximum allowed timeout in seconds (10 minutes). */
const MAX_TIMEOUT_SECONDS = 600;

/** Default timeout in seconds when none is provided. */
const DEFAULT_TIMEOUT_SECONDS = 60;

/** Environment guard prefix injected before every command. */
export const ENV_GUARD = 'export CI=true FORCE_COLOR=1 GIT_TERMINAL_PROMPT=0 2>/dev/null; ';

/**
 * Normalise a Bash tool timeout to a safe value in seconds.
 *
 * The Bash tool interprets `timeout` as seconds, but models frequently emit
 * millisecond values. Missing/null → default; values ≥ 1000 are treated as ms
 * and divided down; everything is capped at the safe maximum.
 */
export const normalizeTimeout = (timeout: number | null | undefined): number => {
  if (timeout === undefined || timeout === null) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  if (timeout < 1000) {
    return timeout > MAX_TIMEOUT_SECONDS ? MAX_TIMEOUT_SECONDS : timeout;
  }
  const seconds = Math.max(1, Math.round(timeout / 1000));
  return Math.min(seconds, MAX_TIMEOUT_SECONDS);
};

/**
 * Prepend the non-interactive environment guards unless already present.
 */
export const guardCommand = (command: string): string => {
  if (command.startsWith(ENV_GUARD)) {
    return command;
  }
  return ENV_GUARD + command;
};

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event) => {
    if (!isToolCallEventType('bash', event)) {
      return;
    }

    event.input.timeout = normalizeTimeout(event.input?.timeout);

    if (typeof event.input?.command === 'string') {
      event.input.command = guardCommand(event.input.command);
    }
  });
}
