/**
 * Bash Timeout Normalizer — enforces seconds-only convention for Bash tool timeouts.
 *
 * Pi's built-in Bash tool interprets `timeout` as SECONDS. However, the model is
 * frequently trained on millisecond-based APIs and may pass values like 120000
 * (intending 120 s) — which the Bash tool interprets as 120,000 seconds (~33 hours).
 *
 * This extension intercepts `tool_call` events for Bash and normalises timeout
 * values that are clearly in milliseconds (≥ 1000) down to seconds.
 *
 * Heuristic: timeout ≥ 1000 → divide by 1000 (no legitimate bash timeout needs
 * 1000+ seconds / ~17 minutes).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isToolCallEventType } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event) => {
    if (!isToolCallEventType('bash', event)) {
      return;
    }

    const timeout = event.input?.timeout;
    if (timeout === undefined || timeout === null) {
      return;
    }

    // Already in seconds range — nothing to do
    if (timeout < 1000) {
      return;
    }

    const seconds = Math.max(1, Math.round(timeout / 1000));
    event.input.timeout = seconds;
  });
}
