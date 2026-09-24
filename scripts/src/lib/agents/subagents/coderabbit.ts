// scripts/src/lib/agents/subagents/coderabbit.ts
//
// Minimal, unattended CodeRabbit loop for subagent PRs: wait for the review
// (auto_review is on for main, so normally it just arrives), then optionally
// request `@coderabbitai autofix` and wait for its commit.
//
// The interactive, richer version lives in .pi/extensions/code_rabbit.ts; this
// one runs inside the detached supervisor so it keeps going after the captain's
// turn — or the captain itself — ends.

import { spawnSync } from 'node:child_process';
import type { ReviewOutcome } from './types.ts';

const POLL_MS = 30_000;
/** If no review appears this long after opening, nudge with `@coderabbitai review`. */
const NUDGE_AFTER_MS = 8 * 60_000;
const AUTOFIX_TIMEOUT_MS = 25 * 60_000;

const BOT = /^coderabbitai(\[bot\])?$/;

type Report = (line: string) => void;

const gh = (args: string[]): string => {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(
      `gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr ?? '').trim().slice(0, 300)}`,
    );
  }
  return (r.stdout ?? '').trim();
};

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

type PrSnapshot = {
  headRefOid: string;
  reviews: { author: { login: string }; state: string; submittedAt: string }[];
  comments: { author: { login: string }; body: string; createdAt: string }[];
};

const snapshot = (pr: string): PrSnapshot =>
  JSON.parse(gh(['pr', 'view', pr, '--json', 'headRefOid,reviews,comments'])) as PrSnapshot;

const comment = (pr: string, body: string): void => {
  gh(['pr', 'comment', pr, '--body', body]);
};

const inlineFindings = (pr: string): number => {
  try {
    const out = gh([
      'api',
      `repos/{owner}/{repo}/pulls/${pr}/comments`,
      '--paginate',
      '--jq',
      '[.[] | select(.user.login | startswith("coderabbitai"))] | length',
    ]);
    return out
      .split('\n')
      .map((n) => Number.parseInt(n, 10) || 0)
      .reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
};

const rateLimitMinutes = (snap: PrSnapshot, since: number): number | undefined => {
  const latest = snap.comments
    .filter((c) => BOT.test(c.author.login) && Date.parse(c.createdAt) >= since)
    .at(-1);
  const m = latest?.body.match(/available in[\s\S]{0,40}?(\d+)\s*min/i);
  return m?.[1] ? Number.parseInt(m[1], 10) + 1 : undefined;
};

/** Wait for a CodeRabbit review submitted after `since`. */
export const waitForReview = async (options: {
  pr: string;
  since: number;
  timeoutMs: number;
  report: Report;
}): Promise<{ state?: string; findings: number }> => {
  const { pr, report } = options;
  let deadline = Date.now() + options.timeoutMs;
  let nudged = false;
  while (Date.now() < deadline) {
    const snap = snapshot(pr);
    const review = snap.reviews
      .filter((r) => BOT.test(r.author.login) && Date.parse(r.submittedAt) >= options.since)
      .at(-1);
    if (review) {
      const findings = inlineFindings(pr);
      report(`CodeRabbit review: ${review.state} (${findings} inline comments)`);
      return { state: review.state, findings };
    }
    const wait = rateLimitMinutes(snap, options.since);
    if (wait) {
      report(`CodeRabbit rate-limited — retrying in ${wait} min`);
      await sleep(wait * 60_000);
      comment(pr, '@coderabbitai review');
      deadline = Math.max(deadline, Date.now() + options.timeoutMs / 2);
      continue;
    }
    if (!nudged && Date.now() - options.since > NUDGE_AFTER_MS) {
      report('No review yet — requesting one explicitly');
      comment(pr, '@coderabbitai review');
      nudged = true;
    }
    await sleep(POLL_MS);
  }
  report('Timed out waiting for CodeRabbit review');
  return { findings: 0 };
};

/** Post `@coderabbitai autofix` and wait for CodeRabbit to push (or decline). */
export const runAutofix = async (options: {
  pr: string;
  report: Report;
}): Promise<Pick<ReviewOutcome, 'autofix' | 'autofixCommit'>> => {
  const { pr, report } = options;
  const before = snapshot(pr).headRefOid;
  const since = Date.now();
  comment(pr, '@coderabbitai autofix');
  report('Requested @coderabbitai autofix');
  const deadline = since + AUTOFIX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const snap = snapshot(pr);
    if (snap.headRefOid !== before) {
      report(`Autofix committed ${snap.headRefOid.slice(0, 7)}`);
      return { autofix: 'committed', autofixCommit: snap.headRefOid };
    }
    const reply = snap.comments
      .filter((c) => BOT.test(c.author.login) && Date.parse(c.createdAt) >= since)
      .at(-1);
    if (reply && /no (changes|fixes|actionable)|nothing to (fix|change)/i.test(reply.body)) {
      report('Autofix: nothing to change');
      return { autofix: 'no-change' };
    }
  }
  report('Autofix timed out');
  return { autofix: 'timeout' };
};
