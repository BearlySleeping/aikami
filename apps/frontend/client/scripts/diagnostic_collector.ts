// apps/frontend/client/scripts/diagnostic_collector.ts
//
// Collects build diagnostics that would otherwise be suppressed, so they can
// be reviewed and ratcheted instead of silently regressing.
//
// Today this covers `INEFFECTIVE_DYNAMIC_IMPORT`: Vite/rolldown emits it when a
// module is dynamically imported somewhere but also statically reachable, so
// the dynamic import cannot move it into another chunk. The old config
// suppressed every such warning; that hides first-party import-boundary
// regressions. Instead, the build records them to a JSON file and
// `check_ineffective_dynamic_imports.ts` compares the first-party subset
// against a reviewed baseline.
//
// Third-party diagnostics (e.g. transformers.js inlining ONNX Runtime) are
// recorded too but never fail the ratchet: they are not Aikami's boundary to
// fix and would make CI noisy.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';

/** One recorded ineffective dynamic import. */
export type IneffectiveDynamicImport = {
  /** The module that is dynamically imported but also statically reachable. */
  readonly module: string;
  /** Whether the module belongs to Aikami source (`src/` or workspace`packages/`). */
  readonly firstParty: boolean;
};

/** The on-disk shape written by the collector plugin. */
export type DiagnosticReport = {
  readonly ineffectiveDynamicImports: readonly IneffectiveDynamicImport[];
};

/**
 * Extracts the dynamically-imported module path from a rolldown
 * INEFFECTIVE_DYNAMIC_IMPORT message.
 *
 * Example:
 *   "src/lib/services/foo.ts is dynamically imported by a.ts, b.ts but also
 *    statically imported by c.ts, dynamic import will not move module into
 *    another chunk."
 */
export const parseIneffectiveDynamicImportModule = (message: string): string | undefined => {
  const match = /^(.+?) is dynamically imported by /.exec(message);
  return match?.[1];
};

/**
 * Whether a module path is Aikami first-party source.
 *
 * The build resolves first-party modules to repo-relative paths
 * (`src/...`, `packages/...`) and third-party modules to paths containing
 * `node_modules`. Anything under `node_modules` is third-party.
 */
export const isFirstPartyModule = (modulePath: string): boolean =>
  !modulePath.includes('node_modules');

/**
 * A mutable collector for build diagnostics.
 *
 * Created in `vite.config.ts` (which owns the `onwarn` hook where rolldown
 * delivers `INEFFECTIVE_DYNAMIC_IMPORT`) and flushed to disk by a
 * `closeBundle` plugin hook.
 */
export type DiagnosticCollector = {
  /** Records one warning message; ignores unrelated codes. */
  record(code: string | undefined, message: string): void;
  /** Writes the collected report to `outputPath`. */
  flush(outputPath: string): void;
};

/** Creates a {@link DiagnosticCollector}. */
export const createDiagnosticCollector = (): DiagnosticCollector => {
  const ineffective = new Map<string, IneffectiveDynamicImport>();

  return {
    record(code, message) {
      if (code !== 'INEFFECTIVE_DYNAMIC_IMPORT') {
        return;
      }
      const module = parseIneffectiveDynamicImportModule(message);
      if (!module) {
        return;
      }
      ineffective.set(module, { module, firstParty: isFirstPartyModule(module) });
    },

    flush(outputPath) {
      const report: DiagnosticReport = {
        ineffectiveDynamicImports: [...ineffective.values()].sort((a, b) =>
          a.module.localeCompare(b.module),
        ),
      };
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    },
  };
};

/**
 * Vite plugin that flushes a diagnostic collector's report on build close.
 *
 * Registered in `vite.config.ts`; the collector itself is fed from `onwarn`.
 *
 * @param collector  The collector to flush.
 * @param outputPath File to write the collected diagnostics to.
 */
export const diagnosticReportPlugin = (
  collector: DiagnosticCollector,
  outputPath: string,
): Plugin => ({
  name: 'aikami:diagnostic-report',
  apply: 'build',
  closeBundle() {
    collector.flush(outputPath);
  },
});
