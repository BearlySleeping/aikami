// scripts/src/lib/ops/guards/source_size_config.ts
//
// Reading and validating the source-file-size POLICY: where the policy files
// are, what they say, whether they are internally consistent, and what each
// path's effective allowance was at a trusted base revision.
//
// Split out of `guard_source_file_size.ts` because that file had grown into two
// responsibilities: "what does the policy allow" (this module — no tree walk,
// no reporting, no exit codes) and "walk the tree, compare, and report" (the
// guard). The guard's own header is explicit that a module owning two
// responsibilities should have one extracted; it would be a poor advertisement
// for the policy not to follow it.
//
// 🔴 Nothing here writes. Writing policy is `--update-baseline` (reduction-only)
// or a reviewed human edit.

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  analyseFileStructure,
  budgetFor,
  isGeneratedFile,
  isTestFile,
  type ScannedFile,
} from '../guard_source_file_size_helpers.ts';
import type { AllowanceBaseline } from './ratchet.ts';
import { readJsonAtRef, readJsonFileSafe } from './ratchet_io.ts';
import {
  classificationMatches,
  type ExemptionSet,
  effectiveAllowances,
  expiredWaiverMessage,
  type LegacyExceptionSet,
  todayIso,
  validateExemptions,
  validateWaivers,
  type WaiverSet,
} from './source_size_policy.ts';

/** Repository root; overridable so tests can run against a fixture tree. */
export const ROOT = resolve(
  process.env.AIKAMI_GUARD_ROOT ?? resolve(import.meta.dir, '../../../../..'),
);

const resolvePolicyPath = (envKey: string, fileName: string): string =>
  resolve(process.env[envKey] ?? resolve(import.meta.dir, `../${fileName}`));

export const BASELINE_PATH = resolvePolicyPath(
  'AIKAMI_GUARD_BASELINE',
  'guard_source_file_size_baseline.json',
);
export const EXEMPTIONS_PATH = resolvePolicyPath(
  'AIKAMI_GUARD_EXEMPTIONS',
  'guard_source_file_size_exemptions.json',
);
export const WAIVERS_PATH = resolvePolicyPath(
  'AIKAMI_GUARD_WAIVERS',
  'guard_source_file_size_waivers.json',
);
/** Pre-split single-exceptions file. Read only from a trusted base revision. */
export const LEGACY_EXCEPTIONS_PATH = resolvePolicyPath(
  'AIKAMI_GUARD_EXCEPTIONS',
  'guard_source_file_size_exceptions.json',
);

export const relFromRoot = (path: string): string => relative(ROOT, path).split(sep).join('/');

// ── Parsing ──────────────────────────────────────────────────────────────

const readJson = (path: string, label: string): unknown => {
  const result = readJsonFileSafe(path, label);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
};

type AllowanceParse = { ok: true; baseline: AllowanceBaseline } | { ok: false; error: string };

export const parseAllowanceBaseline = (raw: unknown, label: string): AllowanceParse => {
  if (raw === undefined) {
    return { ok: true, baseline: {} };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${label} must be a JSON object of path → line count` };
  }
  const baseline: AllowanceBaseline = {};
  for (const [path, value] of Object.entries(raw)) {
    if (path.startsWith('_')) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return { ok: false, error: `${label}: ${path} must map to a positive integer` };
    }
    baseline[path] = value;
  }
  return { ok: true, baseline };
};

/** Extracts just the ceilings from the legacy pre-split exceptions file. */
const parseLegacyExceptions = (raw: unknown): LegacyExceptionSet => {
  const out: LegacyExceptionSet = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [path, value] of Object.entries(raw)) {
    if (path.startsWith('_')) {
      continue;
    }
    const maxLines = (value as { maxLines?: unknown })?.maxLines;
    if (typeof maxLines === 'number' && Number.isInteger(maxLines) && maxLines > 0) {
      out[path] = { maxLines };
    }
  }
  return out;
};

// ── The loaded policy ────────────────────────────────────────────────────

export type Policy = {
  baseline: AllowanceBaseline;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  errors: string[];
};

/** Today's date, overridable so expiry behaviour is testable. */
export const today = (): string => process.env.AIKAMI_GUARD_TODAY ?? todayIso();

export const loadPolicy = (): Policy => {
  const errors: string[] = [];
  const baselineParse = parseAllowanceBaseline(
    readJson(BASELINE_PATH, relFromRoot(BASELINE_PATH)),
    relFromRoot(BASELINE_PATH),
  );
  if (!baselineParse.ok) {
    return { baseline: {}, exemptions: {}, waivers: {}, errors: [baselineParse.error] };
  }

  const exemptionParse = validateExemptions(
    readJson(EXEMPTIONS_PATH, relFromRoot(EXEMPTIONS_PATH)),
  );
  errors.push(...exemptionParse.errors);

  const waiverParse = validateWaivers(readJson(WAIVERS_PATH, relFromRoot(WAIVERS_PATH)), {
    today: today(),
  });
  errors.push(...waiverParse.errors);

  return {
    baseline: baselineParse.baseline,
    exemptions: exemptionParse.exemptions,
    waivers: waiverParse.waivers,
    errors,
  };
};

/**
 * Expired waivers, with the deadline that lapsed.
 *
 * Detected separately from `loadPolicy` so the message is the actionable one
 * rather than a generic parse failure.
 */
export const expiredWaivers = (): { path: string; reviewBy: string }[] =>
  validateWaivers(readJson(WAIVERS_PATH, relFromRoot(WAIVERS_PATH)), { today: today() }).expired;

// ── Configuration checks ─────────────────────────────────────────────────

/**
 * Consistency of the policy as a whole: obsolete entries, overlaps, expired
 * waivers, and untruthful exemption classifications.
 */
export const checkConfiguration = (options: {
  files: readonly ScannedFile[];
  baseline: AllowanceBaseline;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  waiverExpired: readonly { path: string; reviewBy: string }[];
}): string[] => {
  const { files, baseline, exemptions, waivers } = options;
  const errors: string[] = [];
  const byPath = new Map(files.map((file) => [file.path, file]));

  for (const { path, reviewBy } of options.waiverExpired) {
    errors.push(expiredWaiverMessage({ path, reviewBy }));
  }

  // Baseline entries must still resolve, and must not be superseded.
  for (const path of Object.keys(baseline)) {
    if (!byPath.has(path)) {
      errors.push(
        `baseline entry for ${path} no longer resolves to a scanned source file — if this was a rename, the new path needs its own entry (a rename must not be a way to shed recorded debt)`,
      );
      continue;
    }
    if (exemptions[path] || waivers[path]) {
      errors.push(
        `baseline entry for ${path} is superseded by ${exemptions[path] ? 'a permanent exemption' : 'a temporary waiver'} — remove one of them`,
      );
    }
  }

  errors.push(...exemptionErrors({ byPath, exemptions, waivers }));
  errors.push(...waiverErrors({ byPath, waivers }));

  return errors;
};

const exemptionErrors = (options: {
  byPath: Map<string, ScannedFile>;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
}): string[] => {
  const errors: string[] = [];
  for (const [path, exemption] of Object.entries(options.exemptions)) {
    const file = options.byPath.get(path);
    if (!file) {
      errors.push(
        `obsolete exemption for ${path} — the file is missing or generated; remove the exemption`,
      );
      continue;
    }
    const budget = budgetFor(file.kind);
    if (file.lines <= budget.hard) {
      errors.push(
        `obsolete exemption for ${path} — the file is now within the ${budget.hard}-line hard limit; remove the exemption`,
      );
      continue;
    }
    if (exemption.maxLines <= budget.hard) {
      errors.push(
        `obsolete exemption for ${path} — maxLines ${exemption.maxLines} does not relax the ${budget.hard}-line hard limit`,
      );
      continue;
    }
    if (options.waivers[path]) {
      errors.push(
        `configuration error for ${path} — a permanent exemption and a temporary waiver cannot both apply`,
      );
      continue;
    }
    // The declared classification must be TRUE, not merely stated.
    const verdict = verifyExemptionClassification(path, exemption);
    if (verdict !== undefined) {
      errors.push(verdict);
    }
  }
  return errors;
};

/** Returns an error message when a declared classification is not defensible. */
const verifyExemptionClassification = (
  path: string,
  exemption: ExemptionSet[string],
): string | undefined => {
  let content: string;
  try {
    content = readFileSync(resolve(ROOT, path), 'utf8');
  } catch {
    return `exemption for ${path} — the file could not be read to verify its classification`;
  }
  const verdict = classificationVerdict(path, exemption, content);
  return verdict.ok ? undefined : `${path}: ${verdict.reason}`;
};

const classificationVerdict = (
  path: string,
  exemption: ExemptionSet[string],
  content: string,
): { ok: true } | { ok: false; reason: string } =>
  classificationMatches({
    kind: exemption.kind,
    relPath: path,
    structure: analyseFileStructure(content, path),
    isGeneratedFile,
    isTestFile,
    sourceExists: exemption.source !== undefined && existsSync(resolve(ROOT, exemption.source)),
  });

const waiverErrors = (options: {
  byPath: Map<string, ScannedFile>;
  waivers: WaiverSet;
}): string[] => {
  const errors: string[] = [];
  for (const [path, waiver] of Object.entries(options.waivers)) {
    const file = options.byPath.get(path);
    if (!file) {
      errors.push(
        `obsolete waiver for ${path} — the file is missing or generated; remove the waiver`,
      );
      continue;
    }
    const budget = budgetFor(file.kind);
    if (file.lines <= budget.hard) {
      errors.push(
        `obsolete waiver for ${path} — the file is now within the ${budget.hard}-line hard limit; remove the waiver`,
      );
      continue;
    }
    if (waiver.maxLines <= budget.hard) {
      errors.push(
        `obsolete waiver for ${path} — maxLines ${waiver.maxLines} does not relax the ${budget.hard}-line hard limit`,
      );
    }
  }
  return errors;
};

// ── Trusted-base effective-allowance comparison ──────────────────────────

type TrustedSide = {
  baseline: AllowanceBaseline;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  legacy: LegacyExceptionSet;
};

type TrustedRead =
  | { status: 'ok'; side: TrustedSide }
  | { status: 'missing' }
  | { status: 'unavailable'; message: string };

/**
 * Reads the policy as it stood at a git revision.
 *
 * 🔴 Reads the LEGACY single-exceptions file as well as the split files, so the
 * split itself is allowance-neutral: the ceiling a path had before is compared
 * to the ceiling it has now, whichever file expresses it.
 */
export const readTrustedSide = (ref: string): TrustedRead => {
  const side: TrustedSide = { baseline: {}, exemptions: {}, waivers: {}, legacy: {} };

  const baselineRead = readJsonAtRef({ root: ROOT, ref, relPath: relFromRoot(BASELINE_PATH) });
  if (baselineRead.status === 'unavailable') {
    return { status: 'unavailable', message: baselineRead.message };
  }
  if (baselineRead.status === 'ok') {
    const parsed = parseAllowanceBaseline(baselineRead.value, `${ref}:baseline`);
    if (!parsed.ok) {
      return { status: 'unavailable', message: parsed.error };
    }
    side.baseline = parsed.baseline;
  }

  const exemptionsRead = readJsonAtRef({ root: ROOT, ref, relPath: relFromRoot(EXEMPTIONS_PATH) });
  if (exemptionsRead.status === 'unavailable') {
    return { status: 'unavailable', message: exemptionsRead.message };
  }
  if (exemptionsRead.status === 'ok') {
    const parsed = validateExemptions(exemptionsRead.value);
    if (parsed.errors.length > 0) {
      return { status: 'unavailable', message: parsed.errors[0] ?? 'unreadable exemptions' };
    }
    side.exemptions = parsed.exemptions;
  }

  const waiversRead = readJsonAtRef({ root: ROOT, ref, relPath: relFromRoot(WAIVERS_PATH) });
  if (waiversRead.status === 'unavailable') {
    return { status: 'unavailable', message: waiversRead.message };
  }
  if (waiversRead.status === 'ok') {
    // Expiry is not evaluated against the base revision: a waiver that has since
    // lapsed is the current tree's problem, not a reason to skip the comparison.
    const parsed = validateWaivers(waiversRead.value, { today: '0000-01-01' });
    if (parsed.errors.length > 0) {
      return { status: 'unavailable', message: parsed.errors[0] ?? 'unreadable waivers' };
    }
    side.waivers = parsed.waivers;
  }

  const legacyRead = readJsonAtRef({
    root: ROOT,
    ref,
    relPath: relFromRoot(LEGACY_EXCEPTIONS_PATH),
  });
  if (legacyRead.status === 'ok') {
    side.legacy = parseLegacyExceptions(legacyRead.value);
  }

  return { status: 'ok', side };
};

/** The effective allowance for every relevant path on one side. */
export const allowanceMap = (options: {
  files: readonly ScannedFile[];
  baseline: AllowanceBaseline;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  legacy?: LegacyExceptionSet;
}): AllowanceBaseline =>
  effectiveAllowances({
    paths: options.files.map((file) => file.path),
    isTestFile,
    budgetFor,
    baseline: options.baseline,
    exemptions: options.exemptions,
    waivers: options.waivers,
    legacyExceptions: options.legacy,
  });
