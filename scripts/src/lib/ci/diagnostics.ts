// scripts/src/lib/ci/diagnostics.ts
//
// Turns a raw `moon ci` log into a flat list of structured diagnostics.
//
// 🔴 Why this exists: `moon ci` fans out ~300 targets and streams every
// tool's native output into one multi-thousand-line log. A failing PR ends
// with "Process completed with exit code 1" and the actual cause — a
// `file:line:col — message` — is buried somewhere in the middle, printed in
// whichever format that particular tool happens to use. Nobody (human or
// agent) should have to scroll a 2,300-line log to learn that
// config_migration.ts:110 passes the wrong shape to `AiProvider`.
//
// This module is deliberately a PURE parser: log text in, diagnostics out,
// no filesystem and no process. Rendering lives in report_format.ts and the
// CI wiring in report.ts, so the interesting logic here stays unit-testable
// against captured log fixtures (diagnostics.test.ts).
//
// Formats understood — every one of them observed in a real run of this
// repo's gate, not invented:
//
//   1. GitHub workflow commands  `::error file=..,line=..,col=..,title=..::msg`
//      (gha_annotate.ts — guards + typecheck_svelte.ts)
//   2. tsc / tsgo               `path(line,col): error TS2308: msg`
//   3. guard + svelte-check     `❌ path:line:col — msg [code]` (+ indented
//                               continuation lines)
//   4. guard (mvvm/service)     `path:line [rule] msg`
//   5. biome (concise reporter) `× path:line:col: lint/rule: msg`
//   5b. biome (default reporter) `path:line:col lint/rule ━━━` then `× msg`
//   6. bun test                 `error: msg` / `at (path:line:col)` / `(fail) name`
//   6b. playwright (list)       `N) [project] › file:line:col › title` + `Error: msg`
//   7. task failure             `error: script "typecheck" exited with code 1`
//
// Paths are normalised to repo-root-relative POSIX, because a moon task runs
// with the PROJECT as its cwd — `client:typecheck` reporting
// `src/lib/x.ts:3` and `schemas:typecheck` reporting `../types/src/index.ts`
// both mean a different file than the same string does at the repo root, and
// GitHub resolves annotation paths against GITHUB_WORKSPACE.

export type DiagnosticSeverity = 'error' | 'warning';

export type Diagnostic = {
  severity: DiagnosticSeverity;
  /** Moon target that produced it, e.g. `client:typecheck`. */
  target?: string;
  /** Producing tool, used only for display/grouping. */
  tool: string;
  /** Repo-root-relative POSIX path, when the diagnostic has a location. */
  file?: string;
  line?: number;
  col?: number;
  /** Rule id or error code, e.g. `TS2345`, `lint/suspicious/noExplicitAny`. */
  code?: string;
  message: string;
};

export type ParsedCiLog = {
  diagnostics: Diagnostic[];
  /** Targets moon reported as failed, even ones with no file-level output. */
  failedTargets: string[];
};

export type ParseOptions = {
  log: string;
  /** Moon project name → repo-relative project root (from .moon/workspace.yml). */
  projectRoots?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Line normalisation
// ---------------------------------------------------------------------------

// CSI sequences (colour) and OSC 8 hyperlinks. moon emits both when it thinks
// it has a terminal, and GitHub's runner is inconsistent about that.
//
// Built from char codes rather than written as a literal because biome's
// noControlCharactersInRegex rejects `\u001B` inside a regex literal — and it
// is right to in general; stripping terminal escapes is the narrow case where
// the control character IS the thing being matched.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_PATTERN = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  'g',
);

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

// `                  client:typecheck | ::error file=...`
const MOON_PREFIX = /^\s*([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+)\s\|\s?(.*)$/;

// moon's REVIEW section re-prints each failed task's output under a header
// `▮▮▮▮ client:typecheck` with no per-line prefix. The glyph is U+25AE (BLACK
// VERTICAL RECTANGLE) today; matching the whole Geometric Shapes block keeps
// this working if moon changes it, and the `project:task` token plus
// end-of-line anchor is what actually makes the match specific.
const MOON_MARKER = /[\u25A0-\u25FF]/;
const MOON_REVIEW_HEADER = /^[\u25A0-\u25FF\s]*([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+)(?:\s+\(.*\))?\s*$/;

// GitHub's own log decorations, echoed back into stdout by tee.
const GITHUB_LOG_NOISE = /^##\[(?:group|endgroup|error|warning|notice|debug|command)\]/;

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

const WORKFLOW_COMMAND = /^::(error|warning|notice)\s+([^:]*)::(.*)$/;
const TSC_DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z]+\d+):\s*(.*)$/;
const EMOJI_DIAGNOSTIC = /^(?:❌|⚠️|✖|×)\s+(.+?):(\d+):(\d+)\s+[—-]\s+(.*)$/;
const GUARD_RULE_DIAGNOSTIC = /^(\S+\.[a-zA-Z]+):(\d+)\s+\[([^\]]+)\]\s+(.*)$/;
// `--reporter=concise` — one self-contained line per diagnostic. `×` is an
// error, `!` a warning. The `line:col` pair is absent for whole-file
// diagnostics (`× path: format: Formatter would have printed…`), so it is an
// optional group rather than two regexes.
const BIOME_CONCISE =
  /^([×!])\s+(.+?)(?::(\d+):(\d+))?:\s+((?:lint|assist)\/[A-Za-z0-9/]+|format|organizeImports):\s+(.*)$/;
const BIOME_HEADER =
  /^(\S+\.[a-zA-Z]+):(\d+):(\d+)\s+((?:lint|assist)\/[A-Za-z0-9/]+|format|organizeImports)\b/;
const BIOME_FILE_HEADER = /^(\S+\.[a-zA-Z]+)\s+(format|organizeImports|ci)\s+[━]/;
const BIOME_MESSAGE = /^\s{1,4}[×!]\s+(.*)$/;
const BUN_TEST_FAIL = /^\(fail\)\s+(.+?)(?:\s+\[[\d.]+\s*m?s\])?$/;
const BUN_TEST_ERROR = /^error:\s+(.*)$/;
const BUN_TEST_FRAME = /^\s+at\s+.*?\((\/?[^():]+):(\d+):(\d+)\)\s*$/;
// Playwright's `list` reporter numbers each failure and repeats the location
// in a header, then prints the error one indented line below. Only the
// numbered detail block is matched — the `✘ 1 [client] › …` progress line
// above it describes the same failure without the error text, and matching
// both would double every e2e failure.
const PLAYWRIGHT_FAILURE = /^(\d+)\)\s+\[([^\]]+)\]\s+›\s+(.+?):(\d+):(\d+)\s+›\s+(.*?)(?:\s*─+)?$/;
const PLAYWRIGHT_ERROR = /^\s*([A-Za-z]*Error:\s*.+)$/;

const SCRIPT_EXIT = /^error:\s+script\s+"([^"]+)"\s+exited with code\s+(\d+)/;
// moon's own verdict lines. These are authoritative — unlike `error: script
// "x" exited with code 1`, which also appears once at the very end for the
// outer `bun run moon` wrapper and would otherwise be blamed on whichever
// target happened to print last.
const MOON_RUN_TASK_RESULT = /^(pass|fail|skipped)\s+RunTask\(([^)]+)\)/;
const MOON_TASK_FAILED = /Task\s+([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+)\s+failed to run\./;
const TRAILING_CODE = /\s\[(\d+)\]$/;

/** `%0A`-style escaping used by GitHub workflow commands. */
const unescapeCommandValue = (value: string): string =>
  value
    .replaceAll('%0D', '\r')
    .replaceAll('%0A', '\n')
    .replaceAll('%3A', ':')
    .replaceAll('%2C', ',')
    .replaceAll('%25', '%');

const parseCommandProps = (raw: string): Record<string, string> => {
  const props: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) {
      continue;
    }
    props[pair.slice(0, eq).trim()] = unescapeCommandValue(pair.slice(eq + 1));
  }
  return props;
};

const toInt = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Collapses `a/b/../c` → `a/c` without touching the filesystem. */
const normalizeRelative = (path: string): string => {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop();
      } else {
        segments.push('..');
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

const ROOT_PREFIXES = ['apps/', 'packages/', 'scripts/', '.pi/', '.github/', 'docs/'];

const createPathResolver = (projectRoots: Record<string, string>) => {
  return (rawFile: string, target: string | undefined): string => {
    const file = rawFile.split('\\').join('/').trim();
    if (file === '') {
      return file;
    }
    // Absolute paths appear in bun-test stack frames. Anchor them on the
    // first workspace-looking segment rather than guessing the runner's
    // checkout directory, which differs between local runs and CI.
    if (file.startsWith('/')) {
      for (const prefix of ROOT_PREFIXES) {
        const at = file.indexOf(`/${prefix}`);
        if (at !== -1) {
          return file.slice(at + 1);
        }
      }
      return file;
    }
    const relative = file.startsWith('./') ? file.slice(2) : file;
    // Already repo-root-relative — the guards and typecheck_svelte.ts
    // deliberately print paths this way.
    if (ROOT_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
      return normalizeRelative(relative);
    }
    const projectName = target?.split(':')[0];
    const projectRoot = projectName === undefined ? undefined : projectRoots[projectName];
    if (projectRoot === undefined) {
      return normalizeRelative(relative);
    }
    return normalizeRelative(`${projectRoot}/${relative}`);
  };
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type PendingBiome = { file: string; line: number; col: number; code: string };

export const parseCiLog = (options: ParseOptions): ParsedCiLog => {
  const resolvePath = createPathResolver(options.projectRoots ?? {});
  const diagnostics: Diagnostic[] = [];
  const failedTargets = new Set<string>();

  let currentTarget: string | undefined;
  // The last emitted diagnostic, while it can still absorb indented
  // continuation lines (tsc's "Type 'x' is not assignable…" follow-ons).
  let openDiagnostic: Diagnostic | undefined;
  let pendingBiome: PendingBiome | undefined;
  let lastBunError: string | undefined;
  let lastBunFrame: { file: string; line: number; col: number } | undefined;
  // The playwright diagnostic already pushed, still waiting for the `Error:`
  // line that follows its header.
  let playwrightPending: Diagnostic | undefined;

  const push = (diagnostic: Diagnostic): Diagnostic => {
    diagnostics.push(diagnostic);
    openDiagnostic = diagnostic;
    return diagnostic;
  };

  for (const rawLine of stripAnsi(options.log).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') {
      openDiagnostic = undefined;
      continue;
    }

    const prefixed = MOON_PREFIX.exec(line);
    let content = line;
    if (prefixed) {
      const [, target, rest] = prefixed;
      if (target !== currentTarget) {
        openDiagnostic = undefined;
        pendingBiome = undefined;
      }
      currentTarget = target;
      content = rest ?? '';
    } else if (MOON_MARKER.test(line)) {
      // 🔴 moon's REVIEW section re-prints each failed task's output with NO
      // per-line target prefix, under a `▪▪▪▪ <target>` header. Missing that
      // header leaves currentTarget pointing at whichever task streamed last,
      // and every project-relative path in the block then resolves against
      // the wrong project root (`schemas:typecheck`'s `../types/src/index.ts`
      // silently became `apps/frontend/types/src/index.ts`). The header is
      // matched wherever it appears on the line, not only at column 0 — moon
      // indents it, and log shippers add their own prefixes.
      const review = MOON_REVIEW_HEADER.exec(line);
      if (review?.[1] !== undefined) {
        currentTarget = review[1];
        openDiagnostic = undefined;
        pendingBiome = undefined;
        continue;
      }
    }

    content = content.replace(GITHUB_LOG_NOISE, '').trimEnd();
    if (content.trim() === '') {
      continue;
    }
    const trimmed = content.trim();

    // 1. GitHub workflow command ------------------------------------------
    const command = WORKFLOW_COMMAND.exec(trimmed);
    if (command) {
      const [, severity, rawProps, message] = command;
      if (severity === 'notice') {
        continue;
      }
      const props = parseCommandProps(rawProps ?? '');
      const file = props.file;
      push({
        severity: severity === 'warning' ? 'warning' : 'error',
        target: currentTarget,
        tool: props.title ?? 'ci',
        file: file === undefined ? undefined : resolvePath(file, currentTarget),
        line: toInt(props.line),
        col: toInt(props.col),
        message: unescapeCommandValue(message ?? '').trim(),
      });
      openDiagnostic = undefined;
      continue;
    }

    // 2. tsc / tsgo --------------------------------------------------------
    const tsc = TSC_DIAGNOSTIC.exec(trimmed);
    if (tsc) {
      const [, file, line_, col, severity, code, message] = tsc;
      push({
        severity: severity === 'warning' ? 'warning' : 'error',
        target: currentTarget,
        tool: 'tsc',
        file: resolvePath(file ?? '', currentTarget),
        line: toInt(line_),
        col: toInt(col),
        code,
        message: (message ?? '').trim(),
      });
      continue;
    }

    // 3. `❌ path:line:col — message [code]` -------------------------------
    const emoji = EMOJI_DIAGNOSTIC.exec(trimmed);
    if (emoji) {
      const [, file, line_, col, rawMessage] = emoji;
      const codeMatch = TRAILING_CODE.exec(rawMessage ?? '');
      push({
        severity: trimmed.startsWith('⚠') ? 'warning' : 'error',
        target: currentTarget,
        tool: currentTarget?.endsWith(':typecheck') === true ? 'svelte-check' : 'guard',
        file: resolvePath(file ?? '', currentTarget),
        line: toInt(line_),
        col: toInt(col),
        code: codeMatch?.[1] === undefined ? undefined : `TS${codeMatch[1]}`,
        message: (rawMessage ?? '').replace(TRAILING_CODE, '').trim(),
      });
      continue;
    }

    // 4. `path:line [rule] message` (mvvm / service guards) ----------------
    const guardRule = GUARD_RULE_DIAGNOSTIC.exec(trimmed);
    if (guardRule) {
      const [, file, line_, code, message] = guardRule;
      push({
        severity: 'error',
        target: currentTarget,
        tool: 'guard',
        file: resolvePath(file ?? '', currentTarget),
        line: toInt(line_),
        code,
        message: (message ?? '').trim(),
      });
      continue;
    }

    // 5. biome (concise reporter): everything on one line -----------------
    const concise = BIOME_CONCISE.exec(trimmed);
    if (concise) {
      const [, marker, file, line_, col, code, message] = concise;
      push({
        severity: marker === '!' ? 'warning' : 'error',
        target: currentTarget,
        tool: 'biome',
        file: resolvePath(file ?? '', currentTarget),
        line: toInt(line_),
        col: toInt(col),
        code,
        // The concise reporter truncates a format violation to "Formatter
        // would have printed the following content:" and then drops the diff
        // that sentence refers to — a dangling colon that tells a reader
        // nothing. Say what actually happened and how to fix it instead.
        message:
          code === 'format'
            ? 'File is not formatted. Run `bun run fix` to apply the formatter.'
            : (message ?? '').trim(),
      });
      openDiagnostic = undefined;
      continue;
    }

    // 5b. biome (default reporter): header line, message on a later line ---
    const biome = BIOME_HEADER.exec(trimmed);
    if (biome) {
      const [, file, line_, col, code] = biome;
      pendingBiome = {
        file: resolvePath(file ?? '', currentTarget),
        line: toInt(line_) ?? 1,
        col: toInt(col) ?? 1,
        code: code ?? 'lint',
      };
      openDiagnostic = undefined;
      continue;
    }
    const biomeFile = BIOME_FILE_HEADER.exec(trimmed);
    if (biomeFile) {
      const [, file, code] = biomeFile;
      pendingBiome = {
        file: resolvePath(file ?? '', currentTarget),
        line: 1,
        col: 1,
        code: code ?? 'format',
      };
      openDiagnostic = undefined;
      continue;
    }
    if (pendingBiome) {
      const biomeMessage = BIOME_MESSAGE.exec(content);
      if (biomeMessage) {
        push({
          severity: content.includes('×') ? 'error' : 'warning',
          target: currentTarget,
          tool: 'biome',
          file: pendingBiome.file,
          line: pendingBiome.line,
          col: pendingBiome.col,
          code: pendingBiome.code,
          message: (biomeMessage[1] ?? '').trim(),
        });
        pendingBiome = undefined;
        openDiagnostic = undefined;
        continue;
      }
    }

    // 6b. playwright (list reporter) ---------------------------------------
    const playwright = PLAYWRIGHT_FAILURE.exec(trimmed);
    if (playwright) {
      const [, , project, file, line_, col, title] = playwright;
      playwrightPending = push({
        severity: 'error',
        target: currentTarget,
        tool: 'playwright',
        file: resolvePath(file ?? '', currentTarget),
        line: toInt(line_),
        col: toInt(col),
        code: project,
        message: (title ?? '').trim(),
      });
      openDiagnostic = undefined;
      continue;
    }
    if (playwrightPending) {
      const playwrightError = PLAYWRIGHT_ERROR.exec(content);
      if (playwrightError?.[1] !== undefined) {
        playwrightPending.message = `${playwrightPending.message} — ${playwrightError[1].trim()}`;
        playwrightPending = undefined;
        continue;
      }
    }

    // 6. bun test ----------------------------------------------------------
    const frame = BUN_TEST_FRAME.exec(content);
    if (frame && lastBunError !== undefined && lastBunFrame === undefined) {
      lastBunFrame = {
        file: resolvePath(frame[1] ?? '', currentTarget),
        line: toInt(frame[2]) ?? 1,
        col: toInt(frame[3]) ?? 1,
      };
      continue;
    }
    const bunFail = BUN_TEST_FAIL.exec(trimmed);
    if (bunFail) {
      push({
        severity: 'error',
        target: currentTarget,
        tool: 'bun test',
        file: lastBunFrame?.file,
        line: lastBunFrame?.line,
        col: lastBunFrame?.col,
        code: 'test-failure',
        message: `${(bunFail[1] ?? '').trim()} — ${lastBunError ?? 'test failed'}`,
      });
      lastBunError = undefined;
      lastBunFrame = undefined;
      openDiagnostic = undefined;
      continue;
    }

    // 7. task-level failure -------------------------------------------------
    const runTask = MOON_RUN_TASK_RESULT.exec(trimmed);
    if (runTask) {
      if (runTask[1] === 'fail' && runTask[2] !== undefined) {
        failedTargets.add(runTask[2]);
      }
      openDiagnostic = undefined;
      continue;
    }
    const taskFailed = MOON_TASK_FAILED.exec(trimmed);
    if (taskFailed?.[1] !== undefined) {
      failedTargets.add(taskFailed[1]);
      openDiagnostic = undefined;
      continue;
    }
    const scriptExit = SCRIPT_EXIT.exec(trimmed);
    if (scriptExit) {
      // Only a PREFIXED line is a task's own output. The identical line at the
      // end of the log is `bun run moon` itself exiting non-zero, and
      // attributing that to the last-printing target invents a failure.
      if (prefixed && currentTarget !== undefined) {
        failedTargets.add(currentTarget);
      }
      openDiagnostic = undefined;
      continue;
    }

    const bunError = BUN_TEST_ERROR.exec(trimmed);
    if (bunError) {
      lastBunError = (bunError[1] ?? '').trim();
      lastBunFrame = undefined;
      openDiagnostic = undefined;
      continue;
    }

    // Continuation of the previous diagnostic (tsc's nested "Type 'x' is not
    // assignable…" explanation lines are indented under their parent).
    if (openDiagnostic && /^\s{2,}\S/.test(content)) {
      const codeMatch = TRAILING_CODE.exec(trimmed);
      if (codeMatch?.[1] !== undefined && openDiagnostic.code === undefined) {
        openDiagnostic.code = `TS${codeMatch[1]}`;
      }
      openDiagnostic.message = `${openDiagnostic.message}\n${trimmed.replace(TRAILING_CODE, '')}`;
      continue;
    }

    openDiagnostic = undefined;
  }

  // Fallback for a partial log (a single `moon run <target>` piped in by
  // hand) that never reached a verdict line: an error-severity diagnostic is
  // proof enough that its target failed. Warnings are not — biome reports
  // those without failing the task.
  if (failedTargets.size === 0) {
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === 'error' && diagnostic.target !== undefined) {
        failedTargets.add(diagnostic.target);
      }
    }
  }

  return {
    diagnostics: dedupe(diagnostics),
    failedTargets: [...failedTargets].sort(),
  };
};

/**
 * The same diagnostic reaches the log at least twice — once streamed with a
 * `target |` prefix while the task runs, once re-printed in moon's REVIEW
 * block, and for svelte-check a third time as a `::error` annotation.
 *
 * 🔴 The copies are not interchangeable, so this MERGES rather than picking a
 * winner. svelte-check's annotation carries the longest message but no error
 * code; its `❌` line carries the `[2339]` code on a continuation line. Taking
 * the longer copy wholesale silently dropped the TS code from every
 * multi-line type error — the field a reader most wants to search for.
 */
const dedupe = (diagnostics: Diagnostic[]): Diagnostic[] => {
  const byKey = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const firstLine = diagnostic.message.split('\n')[0]?.trim() ?? '';
    const key = [
      diagnostic.file ?? '',
      diagnostic.line ?? '',
      diagnostic.col ?? '',
      firstLine,
    ].join('::');
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...diagnostic });
      continue;
    }
    byKey.set(key, merge(existing, diagnostic));
  }
  return [...byKey.values()];
};

const merge = (a: Diagnostic, b: Diagnostic): Diagnostic => ({
  // A full multi-line tsc explanation beats the one-line summary of the same
  // error; every other field falls back to whichever copy actually has one.
  message: b.message.length > a.message.length ? b.message : a.message,
  severity: a.severity === 'error' || b.severity === 'error' ? 'error' : 'warning',
  target: a.target ?? b.target,
  tool: a.tool === 'ci' ? b.tool : a.tool,
  file: a.file ?? b.file,
  line: a.line ?? b.line,
  col: a.col ?? b.col,
  code: mergeCodes(a, b),
});

/**
 * One spec can run in several playwright projects — release_gate.spec.ts runs
 * in client, client-offline, client-keyboard and (opt-in) client-webgpu. The
 * same assertion failing in each is ONE broken test at ONE location, so
 * emitting four identical annotations on that line would be noise. But WHICH
 * projects it broke in is real signal (offline-only failures look nothing
 * like keyboard-only ones), so the projects are unioned into the code rather
 * than the extra copies being silently dropped.
 */
const mergeCodes = (a: Diagnostic, b: Diagnostic): string | undefined => {
  if (a.code === undefined) {
    return b.code;
  }
  if (b.code === undefined || a.code === b.code) {
    return a.code;
  }
  if (a.tool !== 'playwright' || b.tool !== 'playwright') {
    return a.code;
  }
  return [...new Set([...a.code.split(', '), ...b.code.split(', ')])].sort().join(', ');
};

/**
 * Reads the `projects:` map out of `.moon/workspace.yml` — a flat
 * `name: "path"` block — so diagnostics printed relative to a project cwd can
 * be re-anchored on the repo root. Regex rather than a YAML dependency: the
 * block is flat by construction (moon rejects nested project ids) and the
 * scripts workspace deliberately ships no YAML parser.
 */
export const parseProjectRoots = (workspaceYaml: string): Record<string, string> => {
  const roots: Record<string, string> = {};
  let inProjects = false;
  for (const rawLine of workspaceYaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^projects:\s*$/.test(line)) {
      inProjects = true;
      continue;
    }
    if (!inProjects) {
      continue;
    }
    if (/^\S/.test(line)) {
      break;
    }
    const entry = /^\s+([A-Za-z0-9_-]+):\s*['"]?([^'"#\s]+)['"]?/.exec(line);
    if (entry?.[1] !== undefined && entry[2] !== undefined) {
      roots[entry[1]] = entry[2].replace(/\/+$/, '');
    }
  }
  return roots;
};
