// scripts/src/lib/ci/report_format.ts
//
// Renders parsed diagnostics into the three things CI actually needs:
//
//   1. `::error file=..,line=..::` workflow commands, so every failure lands
//      as an inline annotation on the PR's "Files changed" tab. This is the
//      ONLY place annotations are emitted — the tools themselves are muted
//      during `moon ci` (AIKAMI_CI_ANNOTATIONS=off, see gha_annotate.ts) so
//      biome/tsc failures get the same treatment as guard failures and
//      nothing is annotated twice.
//   2. A Markdown report for the job summary and the sticky PR comment:
//      grouped by file, deep-linked to the exact line, with the full message.
//   3. A copy-pasteable "🤖 Prompt for AI agents" block — the whole failure
//      set as one self-contained instruction, so fixing a red PR is a copy,
//      a paste, and a review rather than a log-archaeology session.
//
// Everything here is pure string building; report.ts does the I/O.

import type { Diagnostic, ParsedCiLog } from './diagnostics.ts';

export type ReportContext = {
  /** `owner/repo`, from GITHUB_REPOSITORY. */
  repository?: string;
  serverUrl?: string;
  /** Head SHA, for permalinks into the reviewed code. */
  sha?: string;
  /** Link back to the workflow run's full log. */
  runUrl?: string;
  /** Outcome of the `moon ci` step: it can fail with zero parsed diagnostics. */
  failed: boolean;
  /** Hard ceiling for the PR comment. GitHub rejects bodies over 65,536. */
  commentLimit?: number;
};

export const COMMENT_MARKER = '<!-- aikami-pr-checks -->';

const DEFAULT_COMMENT_LIMIT = 60_000;
const MAX_CELL_LENGTH = 240;
const MAX_ROWS_PER_FILE = 25;

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type FileGroup = {
  file: string;
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
};

export const groupByFile = (diagnostics: Diagnostic[]): FileGroup[] => {
  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const key = diagnostic.file ?? '(no file)';
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [diagnostic]);
    } else {
      bucket.push(diagnostic);
    }
  }
  return [...groups.entries()]
    .map(([file, group]) => ({
      file,
      diagnostics: [...group].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
      errors: group.filter((d) => d.severity === 'error').length,
      warnings: group.filter((d) => d.severity === 'warning').length,
    }))
    .sort((a, b) => b.errors - a.errors || a.file.localeCompare(b.file));
};

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

const escapeProperty = (value: string): string =>
  value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');

const escapeMessage = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export const renderAnnotations = (diagnostics: Diagnostic[]): string[] => {
  const lines: string[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.file === undefined) {
      continue;
    }
    // A whole-file diagnostic (a format violation) carries no line. Anchoring
    // it on line 1 still puts it on the Files-changed tab, where dropping it
    // would leave the file looking clean.
    const props = [`file=${escapeProperty(diagnostic.file)}`, `line=${diagnostic.line ?? 1}`];
    if (diagnostic.col !== undefined) {
      props.push(`col=${diagnostic.col}`);
    }
    const title = [diagnostic.tool, diagnostic.code].filter(Boolean).join(' ');
    if (title !== '') {
      props.push(`title=${escapeProperty(title)}`);
    }
    lines.push(`::${diagnostic.severity} ${props.join(',')}::${escapeMessage(diagnostic.message)}`);
  }
  return lines;
};

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/** Table cells are single-line: pipes break the row, newlines break the table. */
const cell = (value: string): string =>
  truncate(
    value
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ↳ ')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replace(/\s+/g, ' ')
      .trim(),
    MAX_CELL_LENGTH,
  );

const permalink = (context: ReportContext, diagnostic: Diagnostic): string | undefined => {
  const { serverUrl, repository, sha } = context;
  if (!serverUrl || !repository || !sha || diagnostic.file === undefined) {
    return undefined;
  }
  const anchor = diagnostic.line === undefined ? '' : `#L${diagnostic.line}`;
  return `${serverUrl}/${repository}/blob/${sha}/${diagnostic.file}${anchor}`;
};

const location = (diagnostic: Diagnostic): string => {
  if (diagnostic.line === undefined) {
    return '—';
  }
  return diagnostic.col === undefined
    ? `${diagnostic.line}`
    : `${diagnostic.line}:${diagnostic.col}`;
};

const renderFileSection = (group: FileGroup, context: ReportContext): string => {
  const counts = [
    group.errors > 0 ? `${group.errors} error${group.errors === 1 ? '' : 's'}` : '',
    group.warnings > 0 ? `${group.warnings} warning${group.warnings === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const rows = group.diagnostics.slice(0, MAX_ROWS_PER_FILE).map((diagnostic) => {
    const link = permalink(context, diagnostic);
    const where = location(diagnostic);
    const linked = link === undefined ? where : `[${where}](${link})`;
    const icon = diagnostic.severity === 'error' ? '🔴' : '🟡';
    return `| ${icon} ${linked} | \`${cell(diagnostic.tool)}\` | ${
      diagnostic.code === undefined ? '' : `\`${cell(diagnostic.code)}\``
    } | ${cell(diagnostic.message)} |`;
  });

  const overflow = group.diagnostics.length - rows.length;
  const tail = overflow > 0 ? `\n\n_…and ${overflow} more in this file — see the full log._` : '';

  return [
    '<details open>',
    `<summary><code>${group.file}</code> — <b>${counts}</b></summary>`,
    '',
    '| Where | Tool | Rule | Problem |',
    '| --- | --- | --- | --- |',
    ...rows,
    tail,
    '',
    '</details>',
  ].join('\n');
};

// ---------------------------------------------------------------------------
// The AI-agent prompt
// ---------------------------------------------------------------------------

const AGENT_PREAMBLE = [
  'Fix every CI failure listed below in the aikami monorepo (Bun + Moon workspace,',
  'strict TypeScript, Biome). Follow the conventions in .claude/CLAUDE.md and .pi/skills/:',
  'types not interfaces, arrow functions only, snake_case filenames, options objects for',
  'multi-argument functions, shared types/schemas live in packages/shared/.',
  '',
  'Fix the underlying cause. Do NOT silence a check with `any`, a non-null assertion,',
  'a biome-ignore comment, or a @ts-expect-error unless the diagnostic is genuinely wrong',
  '— and say so explicitly if you conclude that.',
].join('\n');

export const renderAgentPrompt = (parsed: ParsedCiLog, groups: FileGroup[]): string => {
  const lines: string[] = [AGENT_PREAMBLE, ''];

  if (parsed.failedTargets.length > 0) {
    lines.push(`Failing moon targets: ${parsed.failedTargets.join(', ')}`, '');
  }

  for (const group of groups) {
    lines.push(`--- ${group.file}`);
    for (const diagnostic of group.diagnostics) {
      const where = location(diagnostic);
      const tag = [diagnostic.tool, diagnostic.code].filter(Boolean).join(' ');
      const [head = '', ...rest] = diagnostic.message.split('\n');
      lines.push(`L${where}  [${tag}]  ${head}`);
      for (const continuation of rest) {
        lines.push(`    ${continuation.trim()}`);
      }
    }
    lines.push('');
  }

  const verifyTargets =
    parsed.failedTargets.length > 0 && parsed.failedTargets.length <= 6
      ? `bun moon run ${parsed.failedTargets.join(' ')}`
      : 'bun moon run :validate';

  lines.push('Verify the fix with:', '  bun run fix', `  ${verifyTargets}`, '  bun run test');

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

export type RenderedReport = {
  /** Long form, for $GITHUB_STEP_SUMMARY (1 MiB budget). */
  summary: string;
  /** Trimmed to fit a PR comment. */
  comment: string;
  annotations: string[];
  errorCount: number;
  warningCount: number;
};

export const renderReport = (parsed: ParsedCiLog, context: ReportContext): RenderedReport => {
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  const warnings = parsed.diagnostics.filter((d) => d.severity === 'warning');
  const groups = groupByFile(parsed.diagnostics);
  const annotations = renderAnnotations(parsed.diagnostics);

  const header = renderHeader(parsed, context, errors.length, warnings.length);
  const sections = groups.map((group) => renderFileSection(group, context));
  // No diagnostics means nothing to hand an agent — a "🤖 Prompt for AI
  // agents" block on a green run is an invitation to fix a list of nothing.
  const agentBlock =
    parsed.diagnostics.length === 0 ? '' : renderAgentBlock(renderAgentPrompt(parsed, groups));
  const footer = renderFooter(context);

  const summary = [header, ...sections, agentBlock, footer].filter(Boolean).join('\n\n');

  return {
    summary,
    comment: [COMMENT_MARKER, fitToLimit(header, sections, agentBlock, footer, context)].join('\n'),
    annotations,
    errorCount: errors.length,
    warningCount: warnings.length,
  };
};

const renderHeader = (
  parsed: ParsedCiLog,
  context: ReportContext,
  errors: number,
  warnings: number,
): string => {
  if (!context.failed) {
    return [
      '## ✅ PR Checks passed',
      '',
      'Lint, format, typecheck and unit tests are green for everything affected by this PR.',
    ].join('\n');
  }

  if (parsed.diagnostics.length === 0) {
    // A task can fail without emitting a single parseable diagnostic — a
    // build crash, an OOM, a missing env var. Say so plainly instead of
    // rendering an empty, falsely reassuring report.
    return [
      '## ❌ PR Checks failed',
      '',
      'The gate failed but produced no file-level diagnostics — likely a crashed task, a',
      'missing environment variable, or a timeout rather than a lint/type error.',
      parsed.failedTargets.length > 0
        ? `\nFailed targets: ${parsed.failedTargets.map((t) => `\`${t}\``).join(', ')}`
        : '',
      context.runUrl === undefined ? '' : `\n[Open the full log](${context.runUrl})`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const counts = [
    `**${errors}** error${errors === 1 ? '' : 's'}`,
    warnings > 0 ? `**${warnings}** warning${warnings === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const fileCount = new Set(parsed.diagnostics.map((d) => d.file ?? '')).size;

  return [
    `## ❌ PR Checks failed — ${counts} in ${fileCount} file${fileCount === 1 ? '' : 's'}`,
    '',
    parsed.failedTargets.length > 0
      ? `Failing targets: ${parsed.failedTargets.map((t) => `\`${t}\``).join(', ')}`
      : '',
    context.runUrl === undefined ? '' : `[Open the full log](${context.runUrl})`,
  ]
    .filter(Boolean)
    .join('\n');
};

const renderAgentBlock = (prompt: string): string =>
  [
    '<details>',
    '<summary>🤖 Prompt for AI agents</summary>',
    '',
    '```',
    prompt,
    '```',
    '',
    '</details>',
  ].join('\n');

const renderFooter = (context: ReportContext): string =>
  [
    '<sub>Reproduce locally: <code>bun run fix && bun moon run :validate && bun run test</code>',
    context.runUrl === undefined ? '' : ` · <a href="${context.runUrl}">workflow run</a>`,
    '</sub>',
  ].join('');

/**
 * GitHub hard-rejects a comment body over 65,536 characters, and a monorepo
 * gate can easily produce more than that. Drop whole file sections from the
 * tail (they are already sorted worst-first) rather than truncating
 * mid-table, and always keep the agent prompt: it is the part someone acts on.
 */
const fitToLimit = (
  header: string,
  sections: string[],
  agentBlock: string,
  footer: string,
  context: ReportContext,
): string => {
  const limit = context.commentLimit ?? DEFAULT_COMMENT_LIMIT;
  const fixed = [header, agentBlock, footer].join('\n\n').length + COMMENT_MARKER.length;
  const kept: string[] = [];
  let used = fixed;

  for (const section of sections) {
    if (used + section.length + 2 > limit) {
      break;
    }
    kept.push(section);
    used += section.length + 2;
  }

  const dropped = sections.length - kept.length;
  const notice =
    dropped > 0
      ? `_${dropped} more file${dropped === 1 ? '' : 's'} with findings omitted — see the [job summary](${context.runUrl ?? ''})._`
      : '';

  const body = [header, ...kept, notice, agentBlock, footer].filter(Boolean).join('\n\n');
  // Last resort: the agent prompt alone can exceed the limit on a truly
  // enormous failure set. Truncating it still beats a rejected comment.
  return body.length > limit ? `${body.slice(0, limit - 200)}\n\n_…truncated._` : body;
};
