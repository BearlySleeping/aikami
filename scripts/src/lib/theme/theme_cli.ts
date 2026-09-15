// scripts/src/lib/theme/theme_cli.ts
//
// C-529 — the declared Aikami theme validator / builder.
//
// One command, two jobs:
//
//   validate [path...]   Validate theme token files, manifests and packages and
//                        emit machine-readable diagnostics. With no path it
//                        validates the shipped built-in source AND checks that
//                        `aikami_theme.css` is byte-identical to what the
//                        generator produces (the drift gate).
//
//   build [--write]      Regenerate `packages/frontend/theme/src/lib/aikami_theme.css`
//                        from the built-in token source. Without `--write` it is
//                        a check (the default, used by CI).
//
// 🔴 It never evaluates author code and never runs a theme: a token value is
// parsed, re-serialized and bounded by the shared compiler in
// `@aikami/frontend/theme`, which is the same code the client runtime and the
// Hub use. There is no second implementation to drift.
//
// Moon tasks: `scripts:theme-validate`, `scripts:theme-build`.
// Documented for creators in apps/frontend/docs/src/content/docs/guides/theming-your-interface.mdx.
//
// Exits 0 on success, 1 on a validation/drift failure, 2 on a usage error.

import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  checkThemeContrast,
  compileThemeTokenFile,
  generateAikamiThemeCss,
  isCanonicalPackagePath,
  type ThemePackageReader,
  type ThemePackageValidation,
  validateThemePackage,
} from '@aikami/frontend/theme';
import { parseThemePackageManifest, parseThemeTokenFile } from '@aikami/schemas';
import { logger } from '$logger';

export const WORKSPACE_ROOT = resolve(import.meta.dir, '../../../..');
const GENERATED_CSS_PATH = resolve(
  WORKSPACE_ROOT,
  'packages/frontend/theme/src/lib/aikami_theme.css',
);
const BUILTIN_SOURCE_DIR = resolve(WORKSPACE_ROOT, 'packages/frontend/theme/src/lib/theme/builtin');

/** Stable exit codes so CI can distinguish "invalid theme" from "bad usage". */
export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

/** One machine-readable diagnostic. */
export type ThemeCliDiagnostic = {
  readonly code: string;
  readonly message: string;
  readonly subject?: string;
};

/** One validated target. */
export type ThemeCliTargetResult = {
  readonly path: string;
  readonly kind: 'token-file' | 'manifest' | 'package' | 'builtin-source';
  readonly ok: boolean;
  readonly errors: readonly ThemeCliDiagnostic[];
  readonly warnings: readonly ThemeCliDiagnostic[];
  readonly report: readonly string[];
};

/** The whole command result. */
export type ThemeCliResult = {
  readonly command: 'validate' | 'build';
  readonly ok: boolean;
  readonly targets: readonly ThemeCliTargetResult[];
  readonly drift?: { readonly path: string; readonly matches: boolean };
  readonly summary: { readonly checked: number; readonly failed: number };
};

const toDiagnostics = (issues: readonly { code: string; message: string; subject?: string }[]) =>
  issues.map((entry) =>
    entry.subject === undefined
      ? { code: entry.code, message: entry.message }
      : { code: entry.code, message: entry.message, subject: entry.subject },
  );

// ── Filesystem reader ──────────────────────────────────────────────────────

/** Walks a package directory, refusing symlinks and refusing to escape it. */
const walkPackage = (root: string): { paths: string[]; symlinks: string[] } => {
  const paths: string[] = [];
  const symlinks: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        symlinks.push(rel);
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (entry.isFile()) {
        paths.push(rel);
      }
    }
  };
  visit(root);
  return { paths: paths.sort(), symlinks };
};

/** Builds a package reader over a directory. */
export const createDirectoryReader = (
  root: string,
): { reader: ThemePackageReader; symlinks: readonly string[] } => {
  const { paths, symlinks } = walkPackage(root);
  const manifestPath = paths.find((path) => path.toLowerCase() === 'theme.json');
  return {
    symlinks,
    reader: {
      manifestJson:
        manifestPath === undefined ? undefined : readFileSync(join(root, manifestPath), 'utf8'),
      entries: paths,
      readText: (path) => {
        if (!isCanonicalPackagePath(path)) {
          return undefined;
        }
        const absolute = resolve(root, path);
        if (!absolute.startsWith(resolve(root) + sep) || !existsSync(absolute)) {
          return undefined;
        }
        return readFileSync(absolute, 'utf8');
      },
      readBytes: (path) => {
        if (!isCanonicalPackagePath(path)) {
          return undefined;
        }
        const absolute = resolve(root, path);
        if (!absolute.startsWith(resolve(root) + sep) || !existsSync(absolute)) {
          return undefined;
        }
        return new Uint8Array(readFileSync(absolute));
      },
      sha256: (path) => {
        if (!isCanonicalPackagePath(path)) {
          return undefined;
        }
        const absolute = resolve(root, path);
        if (!absolute.startsWith(resolve(root) + sep) || !existsSync(absolute)) {
          return undefined;
        }
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(readFileSync(absolute));
        return hasher.digest('hex');
      },
    },
  };
};

// ── Target validation ──────────────────────────────────────────────────────

const validatePackageDirectory = (root: string): ThemeCliTargetResult => {
  const { reader, symlinks } = createDirectoryReader(root);
  const result: ThemePackageValidation = validateThemePackage(reader);
  const errors = toDiagnostics(result.errors);
  for (const link of symlinks) {
    errors.push({
      code: 'package.symlink',
      message: `"${link}" is a symlink. Symlinks are rejected — they can escape the package root.`,
      subject: link,
    });
  }
  return {
    path: root,
    kind: 'package',
    ok: errors.length === 0,
    errors,
    warnings: toDiagnostics(result.warnings),
    report: result.report,
  };
};

const validateTokenFile = (path: string): ThemeCliTargetResult => {
  const text = readFileSync(path, 'utf8');
  const file = parseThemeTokenFile(safeJson(text));
  if (file === undefined) {
    const manifest = parseThemePackageManifest(safeJson(text));
    if (manifest !== undefined) {
      return {
        path,
        kind: 'manifest',
        ok: true,
        errors: [],
        warnings: [
          {
            code: 'manifest.standalone',
            message:
              'The manifest itself is valid. Validate the whole package directory to check its declared entries and assets.',
          },
        ],
        report: [],
      };
    }
    return {
      path,
      kind: 'token-file',
      ok: false,
      errors: [
        {
          code: 'theme.invalid-shape',
          message:
            'Not a valid Aikami token file or theme manifest (profileVersion, variant and bounded typed tokens are required).',
        },
      ],
      warnings: [],
      report: [],
    };
  }
  const compilation = compileThemeTokenFile(file);
  if (!compilation.ok) {
    return {
      path,
      kind: 'token-file',
      ok: false,
      errors: toDiagnostics(compilation.issues),
      warnings: [],
      report: [],
    };
  }
  return {
    path,
    kind: 'token-file',
    ok: true,
    errors: [],
    warnings: toDiagnostics(checkThemeContrast(compilation.declarations)),
    report: [`variant: ${compilation.variant}`, `tokens: ${compilation.declarations.length}`],
  };
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Validates the shipped built-in token source.
 *
 * Runs the built-in JSON through the *package* validator by presenting it as a
 * synthetic package, so the shipped palette is held to exactly the same bar as
 * a community package.
 */
export const validateBuiltinSource = (): ThemeCliTargetResult => {
  const lightPath = join(BUILTIN_SOURCE_DIR, 'obsidian_chronicle.light.json');
  const darkPath = join(BUILTIN_SOURCE_DIR, 'obsidian_chronicle.dark.json');
  const errors: ThemeCliDiagnostic[] = [];
  const warnings: ThemeCliDiagnostic[] = [];
  const report: string[] = [];

  for (const path of [lightPath, darkPath]) {
    if (!existsSync(path)) {
      errors.push({ code: 'builtin.missing-source', message: `Missing built-in source: ${path}` });
      continue;
    }
    const result = validateTokenFile(path);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    report.push(...result.report);
  }

  return {
    path: BUILTIN_SOURCE_DIR,
    kind: 'builtin-source',
    ok: errors.length === 0,
    errors,
    warnings,
    report,
  };
};

/** Compares the committed stylesheet with freshly generated output. */
export const checkGeneratedCssDrift = (): {
  readonly path: string;
  readonly matches: boolean;
  readonly generated: string;
} => {
  const generated = generateAikamiThemeCss();
  if (!existsSync(GENERATED_CSS_PATH)) {
    return { path: GENERATED_CSS_PATH, matches: false, generated };
  }
  const committed = readFileSync(GENERATED_CSS_PATH, 'utf8');
  return { path: GENERATED_CSS_PATH, matches: committed === generated, generated };
};

// ── Commands ───────────────────────────────────────────────────────────────

/** Runs `validate` over the given targets (or the built-in source by default). */
export const runValidate = (targets: readonly string[]): ThemeCliResult => {
  const results: ThemeCliTargetResult[] = [];
  if (targets.length === 0) {
    results.push(validateBuiltinSource());
  } else {
    for (const target of targets) {
      // Relative targets are resolved against the WORKSPACE ROOT, not the moon
      // project directory the task runs in, so `bun moon run
      // scripts:theme-validate -- ./my-theme` means what a creator expects.
      const absolute = resolve(WORKSPACE_ROOT, target);
      if (!existsSync(absolute)) {
        results.push({
          path: target,
          kind: 'token-file',
          ok: false,
          errors: [{ code: 'target.missing', message: `No such file or directory: ${target}` }],
          warnings: [],
          report: [],
        });
        continue;
      }
      results.push(
        statSync(absolute).isDirectory()
          ? validatePackageDirectory(absolute)
          : validateTokenFile(absolute),
      );
    }
  }

  const drift = checkGeneratedCssDrift();
  if (!drift.matches) {
    results.push({
      path: drift.path,
      kind: 'builtin-source',
      ok: false,
      errors: [
        {
          code: 'builtin.css-drift',
          message:
            'aikami_theme.css does not match the generated output. Run `bun moon run scripts:theme-build` and commit the result.',
          subject: drift.path,
        },
      ],
      warnings: [],
      report: [],
    });
  }

  const failed = results.filter((result) => !result.ok).length;
  return {
    command: 'validate',
    ok: failed === 0,
    targets: results,
    drift: { path: drift.path, matches: drift.matches },
    summary: { checked: results.length, failed },
  };
};

/** Runs `build`. With `write` it rewrites the stylesheet; otherwise it checks. */
export const runBuild = (write: boolean): ThemeCliResult => {
  const source = validateBuiltinSource();
  const drift = checkGeneratedCssDrift();
  if (write && source.ok) {
    writeFileSync(GENERATED_CSS_PATH, drift.generated, 'utf8');
    logger.info('theme:build', { path: GENERATED_CSS_PATH, bytes: drift.generated.length });
  }
  const ok = source.ok && (write || drift.matches);
  return {
    command: 'build',
    ok,
    targets: [source],
    drift: { path: drift.path, matches: write ? true : drift.matches },
    summary: { checked: 1, failed: source.ok ? 0 : 1 },
  };
};

/** Parses argv (without the runtime/script prefix) and runs the command. */
export const main = (argv: readonly string[]): number => {
  const [command, ...rest] = argv;
  if (command === 'validate') {
    const result = runValidate(rest.filter((argument) => !argument.startsWith('-')));
    emit(result);
    return result.ok ? EXIT_OK : EXIT_INVALID;
  }
  if (command === 'build') {
    const write = rest.includes('--write');
    const result = runBuild(write);
    emit(result);
    return result.ok ? EXIT_OK : EXIT_INVALID;
  }
  process.stderr.write(
    'Usage:\n  theme_cli.ts validate [path...]\n  theme_cli.ts build [--write]\n',
  );
  return EXIT_USAGE;
};

/** Writes the machine-readable result to stdout and a human summary to stderr. */
const emit = (result: ThemeCliResult): void => {
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
  for (const target of result.targets) {
    for (const error of target.errors) {
      process.stderr.write(`✗ ${error.code}: ${error.message}\n`);
    }
    for (const warning of target.warnings) {
      process.stderr.write(`! ${warning.code}: ${warning.message}\n`);
    }
  }
  process.stderr.write(
    `theme:${result.command} — ${result.summary.checked - result.summary.failed}/${result.summary.checked} targets ok\n`,
  );
};

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
