// scripts/src/lib/agents/subagents/types.ts
//
// Shared data shapes for the subagent runtime. Pure types only — the pi
// extension (.pi/extensions/subagents.ts) imports these with `import type`,
// so nothing here may carry runtime behaviour.
//
// On-disk layout (one directory per run, see store.ts):
//   <stateRoot>/<id>/spec.json      — immutable launch request (SubagentSpec)
//   <stateRoot>/<id>/state.json     — mutable lifecycle record (SubagentState)
//   <stateRoot>/<id>/prompt.md      — appended system prompt handed to pi
//   <stateRoot>/<id>/task.md        — the task message (turn 1 / follow-ups)
//   <stateRoot>/<id>/events.jsonl   — raw `pi --mode json` stream (append)
//   <stateRoot>/<id>/result.md      — the agent's final answer

/** `read` never gets a worktree and has mutation tools removed; `write` does. */
export type SubagentKind = 'read' | 'write';

/** Thinking levels accepted by `pi --thinking`. */
export type SubagentThinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * CodeRabbit handling after a PR is opened.
 *   auto   — let the heuristics in review_policy.ts decide (default)
 *   always — always wait for (and if needed request) a review
 *   never  — mark the PR `@coderabbitai ignore` so it is never reviewed
 */
export type ReviewMode = 'auto' | 'always' | 'never';

export type PrOptions = {
  /** Open a PR when the agent finishes successfully (write agents only). */
  enabled: boolean;
  base: string;
  title?: string;
  draft: boolean;
  review: ReviewMode;
  /** Post `@coderabbitai autofix` once a review with findings lands. */
  autofix: boolean;
  /** Give up waiting for CodeRabbit after this long. */
  reviewTimeoutMs: number;
};

export type SubagentSpec = {
  id: string;
  /** Short human label; also the worktree slug and herdr tab label. */
  name: string;
  kind: SubagentKind;
  task: string;
  /** Extra context appended to the system prompt (files, constraints…). */
  context?: string;
  model: string;
  /** Where the model choice came from — surfaced so cost is never a surprise. */
  modelSource: 'explicit' | 'env' | 'stealth-discovery' | 'fallback';
  thinking?: SubagentThinking;
  /** Skill names whose SKILL.md is inlined into the system prompt. */
  skills: string[];
  /** Disable pi's own skill discovery (lean prompt, fewer tokens). */
  noSkillDiscovery: boolean;
  /** Explicit `--tools` allowlist; undefined = kind default. */
  tools?: string[];
  /** Extra `--exclude-tools` on top of the kind default. */
  excludeTools: string[];
  /** Git ref the worktree branches from (write agents). */
  base: string;
  /** Run `bun install` in a fresh worktree (write agents). */
  install: boolean;
  /** Reuse an existing worktree checkout instead of creating one. */
  reuseCheckout?: string;
  pr: PrOptions;
  /** Kill the pi process after this long. */
  timeoutMs: number;
  /** Launch inside a herdr tab (visible) vs. a detached process. */
  herdr: boolean;
  /** Repo root of the captain that spawned this run. */
  repoRoot: string;
  /** Captain pi session id — lets a restarted captain re-attach watchers. */
  captainSessionId?: string;
  createdAt: string;
};

export type SubagentStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'publishing'
  | 'reviewing'
  | 'succeeded'
  | 'failed'
  | 'killed'
  | 'lost';

export const TERMINAL_STATUSES: readonly SubagentStatus[] = [
  'succeeded',
  'failed',
  'killed',
  'lost',
];

export type SubagentUsage = {
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
};

export type ReviewOutcome = {
  decision: 'review' | 'skip';
  reason: string;
  /** Terminal CodeRabbit review state, when one arrived. */
  state?: string;
  findings?: number;
  autofix?: 'requested' | 'committed' | 'no-change' | 'timeout' | 'skipped';
  autofixCommit?: string;
};

export type SubagentState = {
  id: string;
  status: SubagentStatus;
  /** Latest one-line progress (last tool call / phase). */
  activity?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  exitCode?: number | null;
  error?: string;
  /** PID of the supervisor process — liveness probe for `lost` detection. */
  supervisorPid?: number;
  /** PID of the pi child — `kill` targets it. */
  piPid?: number;
  piSessionId?: string;
  workspaceId?: string;
  paneId?: string;
  tabId?: string;
  checkoutPath?: string;
  branch?: string;
  usage: SubagentUsage;
  /** First ~400 chars of result.md, for cheap listing. */
  summary?: string;
  pr?: { url: string; number: string; headCommit: string };
  review?: ReviewOutcome;
  /** Files a READ agent changed in the root checkout (should be empty). */
  strayWrites?: string[];
  /** Follow-up message rounds delivered via `message`. */
  rounds: number;
};

/** What a caller gets back from spawn. */
export type SpawnResult = {
  id: string;
  name: string;
  kind: SubagentKind;
  model: string;
  modelSource: SubagentSpec['modelSource'];
  thinking?: SubagentThinking;
  runDir: string;
  checkoutPath?: string;
  branch?: string;
  workspaceId?: string;
  paneId?: string;
};
