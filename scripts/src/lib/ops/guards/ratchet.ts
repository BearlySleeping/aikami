// scripts/src/lib/ops/guards/ratchet.ts
//
// Shared ratchet semantics for the structural guards.
//
// A "ratchet" is the repository's standing rule for existing debt:
//
//   • the debt that exists today is recorded in a baseline file;
//   • that debt may shrink or disappear at any time;
//   • it may never grow, and it may never be swapped for different debt of
//     the same size.
//
// Six guards used to implement that idea six slightly different ways, and two
// of them (`guard-type-safety`, `guard-mvvm-conventions`,
// `guard-service-conventions`) implemented `--update-baseline` as
// "regenerate the baseline from whatever the tree looks like now" — which
// means an autonomous agent could introduce a new violation, run the update
// command, and have it blessed. That is the failure this module exists to
// make impossible:
//
//   `--update-baseline` means SYNCHRONIZE REDUCTIONS. It never means
//   "accept the current state".
//
// The module is deliberately two data shapes over one policy:
//
//   • `diffCounts` / `contractCounts`  — per-file, per-rule violation counts
//     plus optional violation identities (type-safety, mvvm, service
//     conventions, view-model composition, orphaned capability).
//   • `diffAllowances` / `contractAllowances` — per-file numeric ceilings
//     (source-file-size, where the "count" is a line budget rather than a
//     violation count).
//
// Both produce the same `RatchetDiff` vocabulary, so diagnostics, trusted-base
// comparison and the sanctioned contraction step are written once.
//
// 🔴 Nothing here reads the filesystem, the clock, or `process.argv`. Every
// function is pure so the policy is testable without running a guard.

// ── Vocabulary ───────────────────────────────────────────────────────────

/** Per-rule violation counts for one file. Rules with zero are omitted. */
export type RuleCounts = Record<string, number>;

/**
 * One file's entry in a count-based ratchet baseline.
 *
 * `identities` is an opaque, sorted set of stable per-violation identifiers.
 * It exists so that *replacing* one violation with a different one — leaving
 * the count unchanged — is still visible as a change. Guards that can produce
 * a stable identity (a snippet hash, a symbol name) should; guards that cannot
 * leave it out and get count-only semantics.
 */
export type RatchetEntry = {
  counts: RuleCounts;
  identities?: readonly string[];
};

export type RatchetBaseline = Record<string, RatchetEntry>;

/** A numeric allowance per file (line ceilings for the source-size guard). */
export type AllowanceBaseline = Record<string, number>;

/** One ratcheted rule: its id, its human label, and how to fix it. */
export type RatchetRuleSpec = {
  id: string;
  label: string;
  /**
   * Actionable remediation. 🔴 Must never instruct an agent to raise a
   * baseline, extend a waiver, or add a reviewed exception — that is a policy
   * change and belongs to a human. Say what to fix instead.
   */
  remediation: string;
};

export type ChangeKind =
  /** A file that had no baseline entry now has debt. */
  | 'new-file'
  /** A rule that had no baseline count for this file now does. */
  | 'new-rule'
  /** The count or allowance grew. */
  | 'increase'
  /** Same count, different violations. */
  | 'identity-swap'
  /** The count or allowance shrank. */
  | 'decrease'
  /** The baseline entry no longer applies at all. */
  | 'removed';

/** `new-file`/`new-rule`/`increase`/`identity-swap` grow debt; the rest shrink it. */
export const EXPANSION_KINDS = ['new-file', 'new-rule', 'increase', 'identity-swap'] as const;
export const REDUCTION_KINDS = ['decrease', 'removed'] as const;

export type RatchetChange = {
  file: string;
  /** Rule id, or `'lines'` for allowance ratchets. */
  rule: string;
  kind: ChangeKind;
  before: number;
  after: number;
  /** Ready-to-print, agent-readable explanation. */
  detail: string;
};

export type RatchetDiff = {
  /** Debt that grew or was swapped. Always a failure. */
  expansions: RatchetChange[];
  /** Debt that shrank. Lockable by the sanctioned contraction step. */
  reductions: RatchetChange[];
  /**
   * Baseline entries that no longer resolve to anything — a renamed file, a
   * deleted file, or a stale rule id. Reported as a reduction, but called out
   * separately because a rename is usually a mistake rather than progress.
   */
  stale: RatchetChange[];
};

export const isExpansion = (change: RatchetChange): boolean =>
  (EXPANSION_KINDS as readonly string[]).includes(change.kind);

// ── Count ratchet ────────────────────────────────────────────────────────

const sortedEntries = (baseline: RatchetBaseline): [string, RatchetEntry][] =>
  Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b));

/** Union of every rule id mentioned by either side, sorted. */
export const ruleIdsOf = (options: {
  baseline: RatchetBaseline;
  current: RatchetBaseline;
}): string[] => {
  const ids = new Set<string>();
  for (const entry of [...Object.values(options.baseline), ...Object.values(options.current)]) {
    for (const id of Object.keys(entry.counts)) {
      ids.add(id);
    }
  }
  return [...ids].sort();
};

const identitiesMatch = (
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean => {
  if (a === undefined || b === undefined) {
    return true; // No identity tracking on this side — count-only semantics.
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
};

export { identitiesMatch };

/**
 * Compares a baseline against the current tree.
 *
 * Expansions are `new-file`, `new-rule`, `increase`, and — when both sides
 * carry identities — `identity-swap` (same count, different violations).
 * Everything else is a reduction.
 */
export const diffCounts = (options: {
  baseline: RatchetBaseline;
  current: RatchetBaseline;
}): RatchetDiff => {
  const { baseline, current } = options;
  const expansions: RatchetChange[] = [];
  const reductions: RatchetChange[] = [];
  const stale: RatchetChange[] = [];
  const files = new Set([...Object.keys(baseline), ...Object.keys(current)]);

  for (const file of [...files].sort()) {
    const before = baseline[file] ?? { counts: {} };
    const after = current[file];
    if (after === undefined) {
      const dropped = droppedFileChange(file, before);
      if (dropped) {
        stale.push(dropped);
      }
      continue;
    }
    diffOneFile({
      file,
      before,
      after,
      hasBaselineEntry: baseline[file] !== undefined,
      expansions,
      reductions,
    });
  }

  return { expansions, reductions, stale };
};

/**
 * A file that dropped out of the scan entirely: renamed, deleted, or no longer
 * matching the guard's file selection.
 */
const droppedFileChange = (file: string, before: RatchetEntry): RatchetChange | undefined => {
  const total = Object.values(before.counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return undefined;
  }
  return {
    file,
    rule: '*',
    kind: 'removed',
    before: total,
    after: 0,
    detail:
      'the recorded debt no longer applies — either every recorded violation is resolved, or the file is gone/renamed. If it was a rename, the new path needs its own baseline entry: a rename must not be a way to shed recorded debt.',
  };
};

/** Classifies a growth: a raised count, a new rule, or a brand-new file. */
const expansionKind = (options: { from: number; hasBaselineEntry: boolean }): ChangeKind => {
  if (options.from > 0) {
    return 'increase';
  }
  return options.hasBaselineEntry ? 'new-rule' : 'new-file';
};

/** Classifies one file's per-rule counts into expansions and reductions. */
const diffOneFile = (options: {
  file: string;
  before: RatchetEntry;
  after: RatchetEntry;
  hasBaselineEntry: boolean;
  expansions: RatchetChange[];
  reductions: RatchetChange[];
}): void => {
  const { file, before, after } = options;
  const ruleIds = [
    ...new Set([...Object.keys(before.counts), ...Object.keys(after.counts)]),
  ].sort();

  for (const rule of ruleIds) {
    const from = before.counts[rule] ?? 0;
    const to = after.counts[rule] ?? 0;
    if (to > from) {
      options.expansions.push({
        file,
        rule,
        kind: expansionKind({ from, hasBaselineEntry: options.hasBaselineEntry }),
        before: from,
        after: to,
        detail: `${from} → ${to}`,
      });
      continue;
    }
    if (to < from) {
      options.reductions.push({
        file,
        rule,
        kind: 'decrease',
        before: from,
        after: to,
        detail: `${from} → ${to}`,
      });
    }
  }

  // Identity swap: only meaningful when the counts are otherwise unchanged.
  const countsUnchanged = ruleIds.every(
    (rule) => (before.counts[rule] ?? 0) === (after.counts[rule] ?? 0),
  );
  const hasDebt = Object.values(after.counts).some((value) => value > 0);
  if (countsUnchanged && hasDebt && !identitiesMatch(before.identities, after.identities)) {
    options.expansions.push({
      file,
      rule: '*',
      kind: 'identity-swap',
      before: 1,
      after: 1,
      detail:
        'same violation count but different violations — the baseline records which violations were accepted, not just how many',
    });
  }
};

/**
 * Contracts a baseline onto the current tree, reduction-only.
 *
 * The result can only ever be smaller than the input baseline: a file with no
 * baseline entry is dropped (new debt is never contracted in), and a rule's
 * count is clamped to its previous value (an increase can never be written).
 * A caller that skips the expansion check therefore still cannot launder a new
 * violation into the baseline.
 */
export const contractCounts = (options: {
  baseline: RatchetBaseline;
  current: RatchetBaseline;
}): RatchetBaseline => {
  const next: RatchetBaseline = {};
  for (const [file, entry] of sortedEntries(options.current)) {
    const before = options.baseline[file];
    if (before === undefined) {
      continue;
    }
    const counts: RuleCounts = {};
    const ruleIds = [
      ...new Set([...Object.keys(before.counts), ...Object.keys(entry.counts)]),
    ].sort();
    for (const rule of ruleIds) {
      counts[rule] = Math.min(before.counts[rule] ?? 0, entry.counts[rule] ?? 0);
    }
    if (Object.values(counts).every((value) => value === 0)) {
      continue;
    }
    const identities = entry.identities === undefined ? undefined : [...entry.identities].sort();
    next[file] = identities === undefined ? { counts } : { counts, identities };
  }
  return next;
};

// ── Allowance ratchet ────────────────────────────────────────────────────

/**
 * Compares two numeric-allowance maps.
 *
 * Used for the source-file-size ceilings, where "debt" is an accepted line
 * budget rather than a violation count. `before` is the trusted side.
 */
export const diffAllowances = (options: {
  trusted: AllowanceBaseline;
  current: AllowanceBaseline;
}): RatchetDiff => {
  const expansions: RatchetChange[] = [];
  const reductions: RatchetChange[] = [];
  const stale: RatchetChange[] = [];
  const files = new Set([...Object.keys(options.trusted), ...Object.keys(options.current)]);

  for (const file of [...files].sort()) {
    const change = classifyAllowanceChange({
      file,
      before: options.trusted[file] ?? 0,
      after: options.current[file] ?? 0,
    });
    if (change === undefined) {
      continue;
    }
    (change.kind === 'increase' || change.kind === 'new-file' ? expansions : reductions).push(
      change,
    );
  }

  return { expansions, reductions, stale };
};

/**
 * Classifies one path's allowance change, or `undefined` when nothing changed.
 *
 * 🔴 A `0` allowance and an ABSENT allowance are the same statement — "this rule
 * is not accepted here". A pre-framework baseline recorded every rule
 * explicitly, including its zeros, so without this a representation migration
 * reports hundreds of `allowance removed (was 0 lines)` non-events and buries
 * the real signal in the CI summary.
 */
const classifyAllowanceChange = (options: {
  file: string;
  before: number;
  after: number;
}): RatchetChange | undefined => {
  const before = options.before === 0 ? undefined : options.before;
  const after = options.after === 0 ? undefined : options.after;
  if (before === after) {
    return undefined;
  }
  if (before === undefined) {
    return {
      file: options.file,
      rule: 'lines',
      kind: 'new-file',
      before: 0,
      after: after ?? 0,
      detail: `new allowance of ${after} lines`,
    };
  }
  if (after === undefined) {
    return {
      file: options.file,
      rule: 'lines',
      kind: 'removed',
      before,
      after: 0,
      detail: `allowance removed (was ${before} lines)`,
    };
  }
  if (after > before) {
    return {
      file: options.file,
      rule: 'lines',
      kind: 'increase',
      before,
      after,
      detail: `allowance raised ${before} → ${after} lines (+${after - before})`,
    };
  }
  return {
    file: options.file,
    rule: 'lines',
    kind: 'decrease',
    before,
    after,
    detail: `allowance lowered ${before} → ${after} lines`,
  };
};

/** Reduction-only contraction of a numeric-allowance map. */
export const contractAllowances = (options: {
  baseline: AllowanceBaseline;
  current: AllowanceBaseline;
}): AllowanceBaseline => {
  const next: AllowanceBaseline = {};
  for (const [file, value] of Object.entries(options.current).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const before = options.baseline[file];
    if (before === undefined) {
      continue; // New debt is never contracted in silently.
    }
    next[file] = Math.min(before, value);
  }
  return next;
};

// ── Rendering ────────────────────────────────────────────────────────────

const bullet = '      ';

/** Human-readable, agent-actionable expansion report. */
export const renderExpansions = (options: {
  changes: readonly RatchetChange[];
  rules: readonly RatchetRuleSpec[];
  label: string;
}): string[] => {
  const { changes, rules, label } = options;
  if (changes.length === 0) {
    return [];
  }
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const lines: string[] = [`🔴 ${label}: recorded debt grew in ${changes.length} place(s).`];
  for (const change of changes) {
    const rule = ruleById.get(change.rule);
    const ruleLabel =
      change.rule === '*' ? 'the accepted violation set' : (rule?.label ?? change.rule);
    lines.push(`${bullet}${change.file} — ${ruleLabel}: ${change.detail}`);
    if (rule) {
      lines.push(`${bullet}  ↳ ${rule.remediation}`);
    }
  }
  lines.push(
    `${bullet}The baseline records accepted debt and may only shrink. It cannot be raised by`,
    `${bullet}--update-baseline, and it cannot be raised against the trusted base revision.`,
    `${bullet}Fix the violation. If the guard policy itself is wrong, stop and surface that as a`,
    `${bullet}policy change for human review — do not edit the baseline.`,
  );
  return lines;
};

/** Human-readable reduction report — what the sanctioned flow would lock in. */
export const renderReductions = (options: {
  changes: readonly RatchetChange[];
  stale: readonly RatchetChange[];
}): string[] => {
  const { changes, stale } = options;
  const lines: string[] = [];
  if (changes.length > 0) {
    lines.push(
      `✅ debt improved in ${changes.length} place(s) — the sanctioned validation flow can lock this reduction automatically.`,
    );
    for (const change of changes) {
      lines.push(`${bullet}${change.file} [${change.rule}]: ${change.detail}`);
    }
  }
  if (stale.length > 0) {
    lines.push(`⚠️  ${stale.length} baseline entry/entries no longer apply:`);
    for (const change of stale) {
      lines.push(`${bullet}${change.file}: ${change.detail}`);
    }
  }
  return lines;
};

// ── Violations → baseline ────────────────────────────────────────────────

/**
 * Stable, non-cryptographic hash used to build violation identities.
 *
 * FNV-1a, truncated to 8 hex characters. This is an identity, not a security
 * primitive: collisions across a handful of snippets in one file are not a
 * meaningful risk, and a collision only weakens swap detection for those two
 * snippets, never the count ratchet.
 */
export const simpleHash = (input: string): string => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
};

/** A single ratcheted violation found in the tree. */
export type RatchetViolation = {
  file: string;
  rule: string;
  line: number;
  message: string;
  /**
   * Stable identity for this specific violation. Two violations of the same
   * rule in the same file are distinguishable by this value, so swapping one
   * for another at the same count is visible. Omit when no stable identity is
   * available — the ratchet then degrades to count-only semantics.
   */
  identity?: string;
};

/**
 * Folds the current tree's violations into a ratchet baseline.
 *
 * Files with no violations are omitted entirely, so a fully-compliant file
 * never carries a baseline entry.
 */
export const baselineFromViolations = (options: {
  violations: readonly RatchetViolation[];
  identityAware: boolean;
}): RatchetBaseline => {
  const byFile = new Map<string, { counts: RuleCounts; identities: string[] }>();
  for (const violation of options.violations) {
    const entry = byFile.get(violation.file) ?? { counts: {}, identities: [] };
    entry.counts[violation.rule] = (entry.counts[violation.rule] ?? 0) + 1;
    if (options.identityAware && violation.identity !== undefined) {
      entry.identities.push(`${violation.rule}:${violation.identity}`);
    }
    byFile.set(violation.file, entry);
  }

  const baseline: RatchetBaseline = {};
  for (const [file, entry] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    const counts: RuleCounts = {};
    for (const rule of Object.keys(entry.counts).sort()) {
      counts[rule] = entry.counts[rule] ?? 0;
    }
    baseline[file] = options.identityAware
      ? { counts, identities: entry.identities.sort() }
      : { counts };
  }
  return baseline;
};

/**
 * Parses the canonical on-disk baseline shape:
 *
 * ```json
 * { "path/to/file.ts": { "counts": { "t2": 1 }, "identities": ["t2:3712d70f"] } }
 * ```
 *
 * Keys starting with `_` are documentation and are ignored, so a baseline can
 * carry a `_comment` without every guard re-implementing the convention.
 */
export const parseCountsBaseline = (
  raw: unknown,
  label: string,
): { baseline: RatchetBaseline; errors: string[] } => {
  const errors: string[] = [];
  const baseline: RatchetBaseline = {};
  if (raw === undefined) {
    return { baseline, errors };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { baseline, errors: [`${label} must be a JSON object keyed by repo-relative path`] };
  }
  for (const [file, value] of Object.entries(raw as Record<string, unknown>)) {
    if (file.startsWith('_')) {
      continue;
    }
    const parsed = parseCountsEntry(file, value);
    if (typeof parsed === 'string') {
      errors.push(parsed);
      continue;
    }
    baseline[file] = parsed;
  }
  return { baseline, errors };
};

/** Parses one file's baseline entry, or returns the error to report. */
const parseCountsEntry = (file: string, value: unknown): RatchetEntry | string => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${file}: entry must be an object with a "counts" map`;
  }
  const { counts, identities } = value as { counts?: unknown; identities?: unknown };
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) {
    return `${file}: "counts" must be a map of rule id → integer`;
  }
  const parsed: RuleCounts = {};
  for (const [rule, count] of Object.entries(counts as Record<string, unknown>)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      return `${file}: counts.${rule} must be a non-negative integer`;
    }
    parsed[rule] = count;
  }
  if (identities === undefined) {
    return { counts: parsed };
  }
  if (!Array.isArray(identities) || identities.some((id) => typeof id !== 'string')) {
    return `${file}: "identities" must be an array of strings when present`;
  }
  return { counts: parsed, identities: [...(identities as string[])].sort() };
};

/**
 * Parses the PRE-FRAMEWORK baseline shapes, so the trusted-base check survives
 * a representation migration.
 *
 * Three shapes existed before the shared framework:
 *
 *   `{ "a.ts": { t2: 1 } }`                       — flat per-rule counts
 *   `{ "a.ts": { t2: 1, identities: [{rule, hash}] } }` — counts + objects
 *   `{ "a.ts": { orphaned: ["A.b"], _comment: "…" } }`  — symbol list
 *
 * 🔴 This is used ONLY for the base revision's copy of a baseline. The working
 * tree's baseline must be in the canonical shape: reading a stale local baseline
 * as "legacy" would silently reinterpret it instead of failing loudly, which is
 * how a migration turns into an undetected allowance change.
 */
export const parseLegacyCountsBaseline = (
  raw: unknown,
  label: string,
): { baseline: RatchetBaseline; errors: string[] } => {
  const errors: string[] = [];
  const baseline: RatchetBaseline = {};
  if (raw === undefined) {
    return { baseline, errors };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { baseline, errors: [`${label} must be a JSON object keyed by repo-relative path`] };
  }

  for (const [file, value] of Object.entries(raw as Record<string, unknown>)) {
    if (file.startsWith('_')) {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${file}: entry must be an object`);
      continue;
    }
    const entry = value as Record<string, unknown>;

    // Shape 3: an orphan symbol list.
    if (Array.isArray(entry.orphaned)) {
      const symbols = entry.orphaned.filter(
        (symbol): symbol is string => typeof symbol === 'string',
      );
      baseline[file] = { counts: { orphans: symbols.length } };
      continue;
    }

    const counts: RuleCounts = {};
    for (const [rule, count] of Object.entries(entry)) {
      if (rule === 'identities' || rule.startsWith('_')) {
        continue;
      }
      if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
        counts[rule] = count;
      }
    }
    baseline[file] = { counts };
  }

  return { baseline, errors };
};

/** Drops violation identities, keeping the per-rule counts. */
export const stripIdentities = (baseline: RatchetBaseline): RatchetBaseline => {
  const stripped: RatchetBaseline = {};
  for (const [file, entry] of Object.entries(baseline)) {
    stripped[file] = { counts: entry.counts };
  }
  return stripped;
};

// ── Serialization ────────────────────────────────────────────────────────

/**
 * Deterministic JSON for a count baseline: files sorted, rules sorted,
 * identities sorted, two-space indent, trailing newline.
 *
 * Determinism matters because these files are committed: an unstable
 * serialization turns every contraction into a whole-file diff.
 */
export const serializeCounts = (baseline: RatchetBaseline): string => {
  const ordered: RatchetBaseline = {};
  for (const [file, entry] of sortedEntries(baseline)) {
    const counts: RuleCounts = {};
    for (const rule of Object.keys(entry.counts).sort()) {
      counts[rule] = entry.counts[rule] ?? 0;
    }
    ordered[file] =
      entry.identities === undefined
        ? { counts }
        : { counts, identities: [...entry.identities].sort() };
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

/** Deterministic JSON for a numeric-allowance map. */
export const serializeAllowances = (baseline: AllowanceBaseline): string => {
  const ordered: AllowanceBaseline = {};
  for (const file of Object.keys(baseline).sort()) {
    ordered[file] = baseline[file] ?? 0;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
};
