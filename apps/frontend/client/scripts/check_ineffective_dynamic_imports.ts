#!/usr/bin/env bun

// apps/frontend/client/scripts/check_ineffective_dynamic_imports.ts
//
// Ratchet for first-party ineffective dynamic imports.
//
// Vite/rolldown warns `INEFFECTIVE_DYNAMIC_IMPORT` when a module is dynamically
// imported somewhere but also statically reachable — the dynamic import cannot
// split it into another chunk. The old build suppressed every one of these,
// which hid import-boundary regressions. The build now records them
// (`scripts/diagnostic_collector.ts`); this script compares the first-party
// subset against a reviewed baseline and fails on anything new.
//
// Third-party diagnostics (transformers.js inlining ORT, etc.) are excluded:
// they are not Aikami's module graph to repair and would make CI noisy. The
// long-term target is zero first-party cases; the baseline only exists to make
// the remaining known ones explicit and prevent new ones.
//
// Usage:
//   bun scripts/check_ineffective_dynamic_imports.ts [--update]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where the build writes its collected diagnostics. */
export const DEFAULT_DIAGNOSTICS = '.svelte-kit/aikami_diagnostics.json';

/** The reviewed baseline of known first-party ineffective dynamic imports. */
export const DEFAULT_BASELINE = 'scripts/ineffective_dynamic_imports.baseline.json';

/** Baseline file shape. */
export type IneffectiveBaseline = {
  readonly version: 1;
  /** Modules that are currently allowed to remain ineffective. */
  readonly firstPartyModules: readonly string[];
  /** Human-readable reason the allowed entries remain (reviewed context). */
  readonly note?: string;
};

type DiagnosticsFile = {
  ineffectiveDynamicImports: readonly { module: string; firstParty: boolean }[];
};

/** Reads the baseline; an absent baseline means an empty allow-list. */
export const loadBaseline = (path: string): IneffectiveBaseline => {
  if (!existsSync(path)) {
    return { version: 1, firstPartyModules: [] };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as IneffectiveBaseline;
};

/** Reads the build diagnostics; absent means the build did not run. */
export const loadDiagnostics = (path: string): DiagnosticsFile => {
  if (!existsSync(path)) {
    throw new Error(`diagnostics not found at ${path} — run the build first`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DiagnosticsFile;
};

/** Returns the first-party modules in `measured` that are not in `allowed`. */
export const findNewIneffectiveImports = (
  measured: readonly string[],
  allowed: readonly string[],
): string[] => {
  const allowSet = new Set(allowed);
  return [...new Set(measured)].filter((module) => !allowSet.has(module)).sort();
};

/** Returns baseline entries that are no longer present (candidates to remove). */
export const findResolvedIneffectiveImports = (
  measured: readonly string[],
  allowed: readonly string[],
): string[] => {
  const measuredSet = new Set(measured);
  return allowed.filter((module) => !measuredSet.has(module)).sort();
};

/**
 * CLI entry.
 *
 * @returns 0 when no new first-party case appeared, 1 otherwise.
 */
export const runCli = (argv: string[] = process.argv.slice(2)): number => {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const update = argv.includes('--update');
  const diagnosticsPath = resolve(flag('--diagnostics') ?? DEFAULT_DIAGNOSTICS);
  const baselinePath = resolve(flag('--baseline') ?? DEFAULT_BASELINE);

  let diagnostics: DiagnosticsFile;
  try {
    diagnostics = loadDiagnostics(diagnosticsPath);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(`check_ineffective_dynamic_imports: ${(error as Error).message}`);
    return 1;
  }

  const firstParty = diagnostics.ineffectiveDynamicImports
    .filter((entry) => entry.firstParty)
    .map((entry) => entry.module);
  const thirdParty = diagnostics.ineffectiveDynamicImports.filter((entry) => !entry.firstParty);

  const baseline = loadBaseline(baselinePath);
  const newImports = findNewIneffectiveImports(firstParty, baseline.firstPartyModules);
  const resolvedImports = findResolvedIneffectiveImports(firstParty, baseline.firstPartyModules);

  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(
    [
      '',
      `check_ineffective_dynamic_imports: ${firstParty.length} first-party, ${thirdParty.length} third-party (excluded).`,
      '',
    ].join('\n'),
  );

  if (thirdParty.length > 0) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log('Third-party ineffective dynamic imports (not ratcheted):');
    for (const entry of thirdParty) {
      // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
      console.log(`  ${entry.module}`);
    }
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log('');
  }

  if (update) {
    const next: IneffectiveBaseline = {
      version: 1,
      note: 'Reviewed first-party ineffective dynamic imports. Remove entries as boundaries are repaired; never add without review.',
      firstPartyModules: [...new Set(firstParty)].sort(),
    };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(
      `check_ineffective_dynamic_imports: wrote baseline (${next.firstPartyModules.length}) to ${baselinePath}`,
    );
    return 0;
  }

  if (newImports.length > 0) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(
      [
        `✗ check_ineffective_dynamic_imports: ${newImports.length} NEW first-party ineffective dynamic import(s).`,
        '',
        'A module is dynamically imported somewhere but also statically reachable,',
        'so the dynamic import cannot split it into its own chunk. Repair the import',
        'boundary: import the value from a narrow leaf module, or stop re-exporting',
        'the heavy implementation through a barrel consumed at startup.',
        '',
        ...newImports.map((module) => `  ${module}`),
        '',
        'Do not add an entry to the baseline to silence a real new regression.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  if (resolvedImports.length > 0) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(
      [
        `✓ check_ineffective_dynamic_imports: no new first-party cases.`,
        `  ${resolvedImports.length} baseline entr(ies) no longer apply — run with --update to prune:`,
        ...resolvedImports.map((module) => `    ${module}`),
        '',
      ].join('\n'),
    );
    return 0;
  }

  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('✓ check_ineffective_dynamic_imports: no new first-party cases.');
  return 0;
};

if (import.meta.main) {
  process.exit(runCli());
}
