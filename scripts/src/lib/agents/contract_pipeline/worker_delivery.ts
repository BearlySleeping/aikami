// scripts/src/lib/agents/contract_pipeline/worker_delivery.ts
//
// Interactive delivery of a task prompt into a worker pane, plus the evidence
// that the agent actually took it.
//
// 🔴 Extracted from herdr_adapter.ts to keep that module under its reviewed
// source-file-size ceiling. The logic is unchanged; it is expressed against a
// small surface interface so it can be unit-tested without a live pane.

import { isTaskAccepted } from './review_pane.ts';

/** How long to wait for a pane's agent to become receptive before sending. */
export const AGENT_READY_TIMEOUT_MS = 120_000;

/**
 * Separates "we sent it" from "the agent took it".
 *
 * 🔴 Callers must not treat an unacknowledged send as delivered: a busy or
 * blocked agent, or a nonempty composer a human is typing into, would then be
 * read as a successful task hand-off.
 */
export type DeliveryRecord = {
  /** We sent the text (best-effort; the only thing we directly control). */
  attempted: boolean;
  /**
   * We observed evidence the agent accepted the task — a working status after
   * submission. This is what "delivered" means to callers; `attempted` alone
   * must never be reported as success (a busy/blocked composer would otherwise
   * read as a delivered task, and a later nudge could duplicate it).
   */
  acknowledged: boolean;
};

/** The pane-facing primitives interactive delivery needs from the adapter. */
export type DeliverySurface = {
  waitForAgentStatus(options: {
    paneId: string;
    statuses: readonly string[];
    timeoutMs: number;
  }): Promise<boolean>;
  getAgentStatus(paneId: string): Promise<string | undefined>;
  readPaneText(paneId: string): Promise<string | null>;
  /** `pane send-text` with the first-character workaround already applied. */
  sendText(paneId: string, text: string): Promise<void>;
  /** `pane send-keys <pane> Enter`. */
  pressEnter(paneId: string): Promise<void>;
  isCommandRunning(paneId: string): Promise<boolean>;
  sleep(milliseconds: number): Promise<void>;
};

/**
 * Evidence that the agent accepted our task. Delegates to the pure
 * `isTaskAccepted` policy so the decision is unit-tested without a live pane.
 */
export const wasTaskAcknowledged = async (
  surface: Pick<DeliverySurface, 'getAgentStatus' | 'readPaneText'>,
  paneId: string,
): Promise<boolean> => {
  const status = await surface.getAgentStatus(paneId).catch(() => undefined);
  const paneText = await surface.readPaneText(paneId).catch(() => null);
  return isTaskAccepted({ status, paneText });
};

/**
 * Send task text to a pane and confirm the agent accepted it.
 *
 * 🔴 Text is sent ONCE (never re-sent — duplicates fill the input buffer).
 * Only Enter is retried, and only while the composer still holds our text.
 *
 * 🔴 Acceptance is CHECKED, not assumed (C-472 AC-3, brief P1). The old
 * implementation pressed Enter four times and returned `true` unconditionally
 * — so a busy or blocked agent, or a nonempty composer a human was typing
 * into, read as "task delivered". A subsequent nudge would then duplicate the
 * submission or append approval input. Now:
 *
 *   1. Send text once.
 *   2. Press Enter.
 *   3. Poll for acknowledgment: the agent leaves its idle/blocked state, OR
 *      the composer no longer contains our text (it was consumed). A further
 *      Enter is sent ONLY while neither holds — never a blind four-press
 *      storm.
 *
 * @returns a {@link DeliveryRecord} separating "we sent it" from "the agent
 *   took it". Callers must not treat an unacknowledged send as delivered.
 */
export const deliverTaskText = async (
  surface: DeliverySurface,
  options: { paneId: string; text: string },
): Promise<DeliveryRecord> => {
  // Double-idle check: two consecutive observations are much stronger
  // evidence that pi's input handler is truly ready. If agent_status is
  // unavailable (pi doesn't report it to herdr), fall back to a fixed delay.
  for (const delay of [0, 500]) {
    await surface.sleep(delay);
    const ready = await surface.waitForAgentStatus({
      paneId: options.paneId,
      statuses: ['idle', 'blocked'],
      timeoutMs: AGENT_READY_TIMEOUT_MS,
    });
    if (ready) {
      continue;
    }
    // Agent status may not be reported by this pi session.
    // If pi is running in the pane, proceed after a brief init delay.
    if (await surface.isCommandRunning(options.paneId).catch(() => false)) {
      console.warn(
        `⚠️  Pane ${options.paneId} agent_status unavailable — proceeding with fixed delay.`,
      );
      await surface.sleep(5000);
      break;
    }
    console.warn(`⚠️  Pane ${options.paneId} never became receptive — skipping send.`);
    return { attempted: false, acknowledged: false };
  }

  // 🔴 Herdr bug: pane send-text drops the first character — prepend space.
  await surface.sendText(options.paneId, options.text);

  // Dynamic buffer delay: proportional to text length, 500ms min, 2000ms max.
  const bufferWaitMs = Math.min(Math.max(500, options.text.length * 2), 2000);
  await surface.sleep(bufferWaitMs);

  // Press Enter, then verify acceptance instead of assuming it. Each retry
  // is gated on evidence that the previous Enter did NOT land: the composer
  // still holds our text and the agent is still idle/blocked.
  for (const delay of [200, 400, 800, 1600]) {
    await surface.pressEnter(options.paneId);
    await surface.sleep(delay);
    if (await wasTaskAcknowledged(surface, options.paneId)) {
      return { attempted: true, acknowledged: true };
    }
  }

  // Four Enter attempts and the agent still shows no sign of having taken
  // the task. Report attempt-without-acknowledgment so the caller can decide
  // whether a later nudge is safe, rather than claiming success.
  console.warn(
    `⚠️  Pane ${options.paneId} did not acknowledge the task after repeated Enter — ` +
      'treating delivery as unconfirmed.',
  );
  return { attempted: true, acknowledged: false };
};
