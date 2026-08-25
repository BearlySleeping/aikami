// scripts/src/lib/ops/mark_contract_implemented.ts
/**
 * Post-merge contract status advance: `approved`/`in_progress` → `implemented`.
 *
 * Why this exists
 * ---------------
 * Nothing advances the contract file's status today. `orchestrator.ts`'s
 * `checkStatusTransition` deliberately skips the implement stage:
 *
 *   "Skip — implementer/verifier don't update the main contract.
 *    Status is tracked in the run manifest, not the contract file."
 *
 * So a contract keeps `status: approved` forever, even after its PR is merged
 * and its Execution Report has been pulled back onto `main`. This script is
 * the missing edge of that state machine, driven by the one event that
 * actually proves the work landed: the PR merging.
 *
 * Invoked by `.github/workflows/contract-status.yml` on a merged PR:
 *
 *   bun run src/lib/ops/mark_contract_implemented.ts --pr 184 \
 *     --title "C-434: Registry-backed maps" --branch contract-task-c-434-ms1
 *
 * Design notes
 * ------------
 * • **Resolution is by `github.pr_number`** in the contract frontmatter — the
 *   field `.pi/extensions/github_cli.ts` already writes when it opens the PR.
 *   Title/branch are fallbacks for hand-opened PRs. More than one contract may
 *   name the same PR (a batch contract), so every match is advanced.
 *
 * • **Never regresses.** Only `approved` and `in_progress` advance. `draft`
 *   (never approved), the terminal states, and `blocked`/`superseded` are all
 *   left alone — a docs PR merging later must not drag a completed contract
 *   backwards.
 *
 * • **Refuses to outrun the evidence.** `lint_contracts.ts` requires an
 *   Execution Report for `implemented`; stamping the status without one would
 *   turn `--contract` lint red. A contract missing its report is reported and
 *   skipped, not flipped.
 *
 * • **Writes via `commitContractContent`** (plumbing commit + compare-and-swap
 *   push onto `main`, with a refetch-retry on race). The Pi Agent pushes
 *   contract commits to `main` from the developer's machine concurrently; this
 *   is the code path already hardened for exactly that.
 *
 * Not finding a contract is a normal outcome (most PRs aren't contract PRs) —
 * it exits 0. Only a genuine failure (unreadable file, missing status row,
 * failed push) exits 1.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withUpdatedStatus } from '../agents/contract_pipeline/contract_status.ts';
import { commitContractContent, currentBranch } from '../agents/contract_pipeline/contract_sync.ts';
import { runGit } from '../agents/git_worktree.ts';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const CONTRACTS_DIR = join(REPO_ROOT, 'docs/contracts');

/** The status a merged PR advances its contract to. */
const TARGET_STATUS = 'implemented';

/** Statuses a merge may advance. Everything else is left untouched. */
const ADVANCEABLE = new Set(['approved', 'in_progress']);

/** Statuses already at or beyond {@link TARGET_STATUS}. */
const IMPLEMENTED_OR_LATER = new Set(['implemented', 'verified', 'completed']);

// ── Pure helpers (unit-tested) ─────────────────────────────

/** A contract file matched to a merged PR. */
export type ContractMatch = {
  /** Absolute path to the contract file. */
  path: string;
  /** Contract id, e.g. `C-434`. */
  id: string;
  /** How it was matched, for the run log. */
  matchedBy: string;
};

/** What to do with one matched contract. */
export type StatusDecision =
  /** Move the contract forward to `to` — both the table row and the frontmatter. */
  | { action: 'advance'; to: string }
  /** The table is already correct; only the frontmatter lags. Pull it up to `to`. */
  | { action: 'reconcile'; to: string }
  | { action: 'skip'; reason: string };

/** Returns the YAML frontmatter block of a contract, or undefined when it has none. */
export const frontmatterOf = (content: string): string | undefined =>
  content.match(/^---\n([\s\S]*?)\n---/)?.[1];

/** Reads `github.pr_number` from the frontmatter. Undefined when absent or null. */
export const prNumberOf = (content: string): number | undefined => {
  const frontmatter = frontmatterOf(content);
  if (!frontmatter) {
    return undefined;
  }
  const raw = frontmatter.match(/^\s*pr_number:\s*(\d+)\s*$/m)?.[1];
  return raw === undefined ? undefined : Number.parseInt(raw, 10);
};

/**
 * Reads the canonical status from the Metadata table.
 *
 * The table — not the frontmatter — is what `sync_contracts.ts` and
 * `lint_contracts.ts` both read, so it is the value a decision must be made
 * on. `withUpdatedStatus` keeps the two in step when we write.
 */
export const statusOf = (content: string): string =>
  content.match(/\|\s*\*\*Status\*\*\s*\|\s*\*{0,2}([^*|\n]+?)\*{0,2}\s*\|/)?.[1]?.trim() ??
  'not_started';

/**
 * Reads the frontmatter `status:` — the *other* status source, and the one
 * that drifts. `.pi/prompts/contract-implement.md` tells the implementer to
 * update the table field only, so on every pipeline-run contract the
 * frontmatter is left at `approved` while the table says `implemented`.
 * Undefined for the pre-frontmatter contracts (C-011 … C-249).
 */
export const frontmatterStatusOf = (content: string): string | undefined =>
  frontmatterOf(content)?.match(/^status:\s*(\S+)\s*$/m)?.[1];

/**
 * Lifecycle ordering, used only to guarantee a write never moves a status
 * backwards. Mirrors `lint_contracts.ts`'s `VALID_STATUSES`; the off-ramps
 * (`blocked`, `superseded`, `verification_failed`) are deliberately absent —
 * they are not points on the line, and `rankOf` returns undefined for them,
 * which every caller treats as "don't touch".
 */
const STATUS_RANK: Record<string, number> = {
  not_started: 0,
  draft: 1,
  approved: 2,
  in_progress: 3,
  implemented: 4,
  verified: 5,
  completed: 6,
};

const rankOf = (status: string): number | undefined => STATUS_RANK[status];

/** True when the contract carries the Execution Report `implemented` requires. */
export const hasExecutionReport = (content: string): boolean =>
  /^##+\s+Execution Report\b/im.test(content);

/** Extracts a contract id from free text (a PR title or branch name). */
export const contractIdFromText = (text: string | undefined): string | undefined => {
  const match = text?.match(/\b(C|MIG)-(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  return `${(match[1] ?? '').toUpperCase()}-${match[2]}`;
};

/**
 * Decides what a merged PR does to this contract.
 *
 * Two distinct jobs, in priority order:
 *
 *  1. **Advance** — the canonical (table) status is still on the implement
 *     path, so the merge moves it to `implemented`.
 *  2. **Reconcile** — the table is already `implemented` or later (the
 *     implementer stamped it) but the frontmatter still lags. This is the
 *     common case in practice, because the implement prompt only ever touches
 *     the table. Pull the frontmatter up to the table's value — never past it,
 *     and never backwards.
 *
 * The evidence check sits inside case 1 only: a contract whose table already
 * says `implemented` has its report by definition, and re-running over it must
 * report the honest reason rather than complaining about evidence.
 */
export const decideStatusAdvance = (options: {
  status: string;
  frontmatterStatus: string | undefined;
  hasReport: boolean;
}): StatusDecision => {
  const { status, frontmatterStatus, hasReport } = options;

  if (ADVANCEABLE.has(status)) {
    if (!hasReport) {
      return {
        action: 'skip',
        reason: 'no `## Execution Report` — `lint_contracts --contract` would reject `implemented`',
      };
    }
    return { action: 'advance', to: TARGET_STATUS };
  }

  if (IMPLEMENTED_OR_LATER.has(status)) {
    const currentRank = frontmatterStatus === undefined ? undefined : rankOf(frontmatterStatus);
    const targetRank = rankOf(status);
    if (currentRank !== undefined && targetRank !== undefined && currentRank < targetRank) {
      return { action: 'reconcile', to: status };
    }
    return { action: 'skip', reason: `already \`${status}\` — at or beyond \`${TARGET_STATUS}\`` };
  }

  if (status === 'draft') {
    return { action: 'skip', reason: 'still `draft` — never approved, so a merge cannot imply it' };
  }
  return { action: 'skip', reason: `status \`${status}\` is not on the implement path` };
};

// ── Resolution ─────────────────────────────────────────────

const contractFiles = (contractsDir: string): string[] => {
  try {
    return readdirSync(contractsDir).filter(
      (f) => /^(C|MIG)-\d+/.test(f) && f.endsWith('.md') && f !== 'TEMPLATE.md',
    );
  } catch {
    return [];
  }
};

const idOf = (fileName: string): string => fileName.match(/^((?:C|MIG)-\d+)/)?.[1] ?? fileName;

/**
 * Finds every contract naming this PR, falling back to an id parsed out of the
 * PR title or branch when no frontmatter link exists (a hand-opened PR).
 *
 * @param options.contractsDir - Directory to scan (parameterised for tests).
 * @param options.prNumber - The merged PR's number.
 * @param options.title - PR title, searched for `C-XXX` as a fallback.
 * @param options.branch - PR head branch, searched for `c-xxx` as a fallback.
 */
export const resolveContracts = (options: {
  contractsDir: string;
  prNumber: number;
  title?: string | undefined;
  branch?: string | undefined;
}): ContractMatch[] => {
  const { contractsDir, prNumber, title, branch } = options;
  const files = contractFiles(contractsDir);

  const linked: ContractMatch[] = [];
  for (const file of files) {
    const path = join(contractsDir, file);
    if (prNumberOf(readFileSync(path, 'utf-8')) === prNumber) {
      linked.push({ path, id: idOf(file), matchedBy: `frontmatter pr_number: ${prNumber}` });
    }
  }
  if (linked.length > 0) {
    return linked;
  }

  const fallbackId = contractIdFromText(title) ?? contractIdFromText(branch);
  if (!fallbackId) {
    return [];
  }
  const source = contractIdFromText(title) ? 'PR title' : 'branch name';
  return files
    .filter((f) => idOf(f) === fallbackId)
    .map((f) => ({
      path: join(contractsDir, f),
      id: fallbackId,
      matchedBy: `${source} (no frontmatter link)`,
    }));
};

// ── Safety: never write from a stale checkout ──────────────

/**
 * Returns a refusal message when writing from this checkout would corrupt it,
 * undefined when it's safe.
 *
 * `commitContractContent` fast-forwards `refs/heads/main` to its new commit
 * without touching the working tree — deliberate, and correct both in CI (a
 * fresh checkout, always at the tip) and in a caught-up local checkout. On a
 * *stale* one that is sitting on `main`, it drags HEAD past content the index
 * and working tree have never seen, and everything that landed in between
 * stages itself as a reverse diff: `git status` shows deletions and
 * modifications that are one `git commit` away from silently reverting
 * somebody's merged PR.
 *
 * Not hypothetical — this is exactly what happened the first time this script
 * ran locally: PR #184 merged mid-backfill, and its 14 files staged themselves
 * as deletions in the developer's checkout.
 *
 * Only a checkout that is *on* `main` is at risk; on any other branch the
 * moved ref isn't HEAD and nothing is disturbed.
 */
const staleCheckoutRefusal = (repoRoot: string): string | undefined => {
  if (currentBranch(repoRoot) !== 'main') {
    return undefined;
  }
  try {
    runGit('fetch origin main', { cwd: repoRoot, timeoutMs: 30_000 });
    const local = runGit('rev-parse refs/heads/main', { cwd: repoRoot, timeoutMs: 5000 }).trim();
    const remote = runGit('rev-parse refs/remotes/origin/main', {
      cwd: repoRoot,
      timeoutMs: 5000,
    }).trim();
    if (local === remote) {
      return undefined;
    }
    return [
      `This checkout is on \`main\` at ${local.slice(0, 8)}, but origin/main is at ${remote.slice(0, 8)}.`,
      'Writing from here would move HEAD past content your working tree has never seen.',
      'Run `git pull` first, then re-run. (Or pass --dry-run to preview without writing.)',
    ].join('\n   ');
  } catch {
    // No remote, offline, or no local main — nothing to compare, so nothing
    // to refuse on. The commit path handles those cases on its own.
    return undefined;
  }
};

// ── CLI ────────────────────────────────────────────────────

type Options = {
  prNumber: number;
  title: string | undefined;
  branch: string | undefined;
  dryRun: boolean;
};

const parseArgs = (argv: string[]): Options | { error: string } => {
  let prNumber: number | undefined;
  let title: string | undefined;
  let branch: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--pr':
        prNumber = next === undefined ? undefined : Number.parseInt(next, 10);
        i++;
        break;
      case '--title':
        title = next;
        i++;
        break;
      case '--branch':
        branch = next;
        i++;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        return { error: `Unknown argument: ${arg}` };
    }
  }

  if (prNumber === undefined || Number.isNaN(prNumber)) {
    return { error: '--pr <number> is required' };
  }
  return { prNumber, title, branch, dryRun };
};

/** Mirrors the run log into the GitHub Actions job summary when running in CI. */
const summary: string[] = [];
const report = (line: string): void => {
  console.log(line);
  summary.push(line);
};

const flushSummary = (): void => {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path || summary.length === 0) {
    return;
  }
  try {
    // Appended, not written: other steps in the same job share this file.
    appendFileSync(path, `${summary.join('\n')}\n`);
  } catch {
    // A summary that fails to write must never fail the job.
  }
};

const main = (): void => {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`❌ ${parsed.error}`);
    console.error(
      'Usage: bun run src/lib/ops/mark_contract_implemented.ts --pr <number> [--title <t>] [--branch <b>] [--dry-run]',
    );
    process.exit(1);
  }

  const { prNumber, title, branch, dryRun } = parsed;

  if (!dryRun) {
    const refusal = staleCheckoutRefusal(REPO_ROOT);
    if (refusal) {
      console.error(`❌ ${refusal}`);
      process.exit(1);
    }
  }

  const matches = resolveContracts({ contractsDir: CONTRACTS_DIR, prNumber, title, branch });

  if (matches.length === 0) {
    report(`ℹ️ PR #${prNumber} is not linked to any contract — nothing to do.`);
    flushSummary();
    return;
  }

  let failed = false;
  for (const match of matches) {
    if (!existsSync(match.path)) {
      report(`❌ ${match.id}: contract file vanished (${match.path}).`);
      failed = true;
      continue;
    }

    const content = readFileSync(match.path, 'utf-8');
    const status = statusOf(content);
    const frontmatterStatus = frontmatterStatusOf(content);
    const decision = decideStatusAdvance({
      status,
      frontmatterStatus,
      hasReport: hasExecutionReport(content),
    });

    if (decision.action === 'skip') {
      report(`⏭️ ${match.id}: ${decision.reason}. (matched by ${match.matchedBy})`);
      continue;
    }

    let updated: string;
    try {
      updated = withUpdatedStatus(content, decision.to);
    } catch {
      report(`❌ ${match.id}: no \`| **Status** |\` row to update — contract needs a fix by hand.`);
      failed = true;
      continue;
    }

    const change =
      decision.action === 'advance'
        ? `\`${status}\` → \`${decision.to}\``
        : `frontmatter \`${frontmatterStatus}\` → \`${decision.to}\` (table already \`${status}\`)`;

    if (dryRun) {
      report(`🔎 ${match.id}: would set ${change} (matched by ${match.matchedBy}).`);
      continue;
    }

    const sync = commitContractContent({
      repoRoot: REPO_ROOT,
      contractPath: match.path,
      content: updated,
      message: `docs(contracts): ${match.id} ${decision.to} (#${prNumber})`,
    });

    if (!sync.ok) {
      report(`❌ ${match.id}: ${sync.message}`);
      failed = true;
      continue;
    }
    report(
      sync.committed
        ? `✅ ${match.id}: set ${change}, pushed to main.`
        : `⏭️ ${match.id}: ${sync.message}`,
    );
  }

  flushSummary();
  process.exit(failed ? 1 : 0);
};

if (import.meta.main) {
  main();
}
