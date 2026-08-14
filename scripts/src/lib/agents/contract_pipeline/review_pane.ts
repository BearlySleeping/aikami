// scripts/src/lib/agents/contract_pipeline/review_pane.ts
//
// Safety logic for the ONE pane a human shares with the pipeline: the review
// tab. Everything here is pure so it can be tested without a live Herdr.
//
// 🔴 WHY THIS EXISTS — the C-390 incident.
//
// On resume the orchestrator typed "Pipeline resumed. Your session was
// preserved — continue from where you left off." into the review pane and
// pressed Enter. The review captain had already delivered its report and the
// user was mid-sentence in the composer. The injected text was appended to
// the user's half-typed line and submitted as one message, so the captain saw
//
//     "please make the implementer Pipeline resumed. Your session was
//      preserved — continue from where you left off. Branch … is still pushed."
//
// and acted on the mashup. Three separate defects combined:
//
//   1. The nudge was sent even though the captain had already responded —
//      it carried no information the captain needed.
//   2. `idle` was treated as "safe to type into". For a worker pane that is
//      true; for the review pane `idle` means *the human is at the keyboard*,
//      which is precisely when typing into it is destructive.
//   3. Enter was pressed four times with backoff (a launch-time PTY
//      workaround), so even a stray keystroke got committed.
//
// The rules below encode the inverse: a human-shared pane is written to only
// when it is provably empty and idle, at most once, and never with content
// the agent could mistake for a new instruction.

/** Box-drawing horizontal rule (U+2500) that frames pi's composer. */
const RULE_CHAR = '─';

/** A line is a composer rule when it is all U+2500 (≥8 of them) plus space. */
const isRuleLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.length < 8) {
    return false;
  }
  return [...trimmed].every((ch) => ch === RULE_CHAR);
};

/** Outcome of locating the composer inside a pane snapshot. */
export type ComposerRead =
  | { found: true; text: string }
  /** No composer rules in the snapshot — pi may be booting, or not pi at all. */
  | { found: false; text: '' };

/**
 * How many trailing lines the closing rule may sit above.
 *
 * pi pins the composer to the bottom, with only the footer (cwd, token
 * counters, MCP line) below it. Requiring the closing rule to be within this
 * window stops a rule-like pair in *agent output* — a rendered table whose
 * borders happen to end the snapshot — from being mistaken for an empty
 * composer, which is the one way this parser could wrongly report "safe to
 * send". Generous enough (12) to absorb footer growth and blank padding.
 */
const COMPOSER_BOTTOM_WINDOW = 12;

/**
 * Extract the text a human has typed into pi's composer but not yet sent.
 *
 * pi renders the composer as the LAST pair of full-width rules in the visible
 * snapshot, with the footer (cwd, token counters, MCP line) below it:
 *
 *     ─────────────────────────────────────────
 *     please ask claude sonnet about what has
 *     ─────────────────────────────────────────
 *     ~/.herdr/worktrees/aikami/… (branch…)
 *     ↑72k ↓15k $0.017 …
 *
 * Uses the last pair rather than the first so scrollback that happens to
 * contain rules (a rendered table, a previous composer) cannot shadow the
 * live one.
 */
export const readComposer = (paneText: string): ComposerRead => {
  const lines = paneText.split('\n');
  const ruleIndexes: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (isRuleLine(line)) {
      ruleIndexes.push(index);
    }
  }
  const close = ruleIndexes.at(-1);
  const open = ruleIndexes.at(-2);
  if (close === undefined || open === undefined || close <= open) {
    return { found: false, text: '' };
  }
  // Trailing blank lines are terminal padding, not content — ignore them when
  // measuring the distance to the bottom.
  let lastContentIndex = lines.length - 1;
  while (lastContentIndex > 0 && lines[lastContentIndex]?.trim() === '') {
    lastContentIndex--;
  }
  if (lastContentIndex - close > COMPOSER_BOTTOM_WINDOW) {
    return { found: false, text: '' };
  }
  const text = lines
    .slice(open + 1, close)
    .join('\n')
    .trim();
  return { found: true, text };
};

/**
 * True when the pane must NOT be typed into because a human has unsent text
 * in the composer.
 *
 * 🔴 FAILS SAFE: an unparseable snapshot (empty read, herdr error, a pi
 * version that reframes its composer) returns `true`. Skipping an
 * informational nudge costs nothing; clobbering a half-typed message costs
 * the user their turn — see the C-390 incident above.
 */
export const hasPendingUserInput = (paneText: string | null): boolean => {
  if (paneText === null || paneText.trim() === '') {
    return true;
  }
  const composer = readComposer(paneText);
  if (!composer.found) {
    return true;
  }
  return composer.text !== '';
};

/** Herdr agent lifecycle states, as reported by `pane list` / `agent list`. */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

/** States that mean the agent has stopped producing and yielded the keyboard. */
const SETTLED: readonly string[] = ['idle', 'blocked', 'done'];

export const isSettledStatus = (status: string | undefined): boolean =>
  status !== undefined && SETTLED.includes(status);

/**
 * Whether it is safe to inject text into a pane a human shares with us.
 *
 * All three conditions must hold; any missing signal counts against sending.
 *
 * @param status   - Herdr `agent_status`, or undefined when unreported.
 * @param paneText - Visible pane snapshot, or null when the read failed.
 */
export const canSendToReviewPane = (options: {
  status: string | undefined;
  paneText: string | null;
}): { ok: boolean; reason: string } => {
  if (options.status === 'working') {
    return { ok: false, reason: 'agent is mid-response' };
  }
  // Unreported status is not evidence of readiness. Worker panes tolerate the
  // guess because nobody is typing into them; the review pane does not.
  if (!isSettledStatus(options.status)) {
    return { ok: false, reason: `agent status unavailable (${options.status ?? 'none'})` };
  }
  if (hasPendingUserInput(options.paneText)) {
    return { ok: false, reason: 'composer holds unsent user input' };
  }
  return { ok: true, reason: 'pane idle with an empty composer' };
};

// ── First-response detection (alarm timing) ─────────────────

/**
 * Poll-driven state machine that answers "has the review captain finished
 * its FIRST response?" — the moment the alarm should sound, since that is
 * when the pane genuinely wants the human.
 *
 * Two-phase, because the alarm must not fire on the idle that precedes the
 * agent picking up its task:
 *
 *   waiting → working   the captain accepted the initial prompt
 *   working → settled   it stopped producing … but pi also reports `idle`
 *                       BETWEEN LLM turns, so a single settled sample is not
 *                       enough. `settleSamples` consecutive settled reads are
 *                       required; an inter-turn blip resets the count.
 */
export type FirstResponsePhase = 'waiting_for_start' | 'working' | 'responded';

export type FirstResponseState = {
  phase: FirstResponsePhase;
  /** Consecutive settled observations seen while in the `working` phase. */
  settledStreak: number;
};

export const initialFirstResponseState = (): FirstResponseState => ({
  phase: 'waiting_for_start',
  settledStreak: 0,
});

/**
 * Fold one `agent_status` sample into the state machine. Pure — the caller
 * owns the polling loop and the clock.
 *
 * @param settleSamples - Consecutive settled reads required to call it done.
 */
export const advanceFirstResponse = (
  state: FirstResponseState,
  status: string | undefined,
  settleSamples = 4,
): FirstResponseState => {
  if (state.phase === 'responded') {
    return state;
  }
  if (state.phase === 'waiting_for_start') {
    return status === 'working'
      ? { phase: 'working', settledStreak: 0 }
      : { phase: 'waiting_for_start', settledStreak: 0 };
  }
  // phase === 'working'
  if (!isSettledStatus(status)) {
    return { phase: 'working', settledStreak: 0 };
  }
  const streak = state.settledStreak + 1;
  return streak >= settleSamples
    ? { phase: 'responded', settledStreak: streak }
    : { phase: 'working', settledStreak: streak };
};
