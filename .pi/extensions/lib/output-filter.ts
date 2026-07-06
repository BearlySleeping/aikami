// .pi/extensions/lib/output-filter.ts
//
// Shared output filtering utilities for pi extensions.
// Reduces tool output size by:
//   - Parsing moon JSON into lightweight summaries (instead of 62KB dumps)
//   - Filtering moon run output to errors/warnings + summary
//   - Smart truncation with preview

// ── Types ─────────────────────────────────────────────────────────

export type LightProject = {
  id: string;
  layer: string;
  /** Filesystem path relative to repo root (from moon's `source` field) */
  source: string;
  tags: string[];
  deps: string[];
  desc?: string;
};

// ── Moon Projects JSON Parser ────────────────────────────────────

const MOON_JSON_MAX_RAW = 512_000; // 512KB hard cap

/**
 * Parses `moon query projects` JSON output into a lightweight array.
 * Only extracts id, layer, tags, deps, and description.
 * If parsing fails, returns null.
 */
export function parseMoonProjects(raw: string): LightProject[] | null {
  if (!raw || raw.length > MOON_JSON_MAX_RAW) {
    return null;
  }

  try {
    const data = JSON.parse(raw);
    const projects = data?.projects;
    if (!Array.isArray(projects)) {
      return null;
    }

    return projects.map((p: Record<string, unknown>) => {
      const config = (p.config as Record<string, unknown>) ?? {};
      const depsRaw = (config.dependsOn as Array<{ id?: string } | string>) ?? [];
      const deps = depsRaw.map((d) => (typeof d === 'string' ? d : (d.id ?? '?')));
      const projectMeta = config.project as Record<string, unknown> | undefined;

      return {
        id: String(p.id ?? '?'),
        layer: String(config.layer ?? '?'),
        source: String(p.source ?? '?'),
        tags: (config.tags as string[]) ?? [],
        deps,
        desc: String(projectMeta?.description ?? ''),
      } as LightProject;
    });
  } catch {
    return null;
  }
}

/**
 * Formats a lightweight project list as a compact string with filesystem paths.
 */
export function formatProjectList(projects: LightProject[]): string {
  if (projects.length === 0) {
    return 'No projects.';
  }

  const apps = projects.filter((p) => p.layer === 'application');
  const libs = projects.filter((p) => p.layer === 'library');
  const other = projects.filter((p) => p.layer !== 'application' && p.layer !== 'library');

  const fmt = (p: LightProject) => (p.source && p.source !== '?' ? `${p.id} (${p.source})` : p.id);

  const parts: string[] = [];
  if (apps.length > 0) {
    parts.push(`**Apps (${apps.length})**: ${apps.map(fmt).join(', ')}`);
  }
  if (libs.length > 0) {
    parts.push(`**Libs (${libs.length})**: ${libs.map(fmt).join(', ')}`);
  }
  if (other.length > 0) {
    parts.push(`**Other (${other.length})**: ${other.map(fmt).join(', ')}`);
  }
  parts.push(`Total: ${projects.length} projects`);
  return parts.join('\n');
}

/**
 * Extracts just the project IDs from affected moon query output.
 */
export function extractAffectedIds(raw: string): string[] {
  const projects = parseMoonProjects(raw);
  if (projects) {
    return projects.map((p) => p.id);
  }
  // Fallback: try to extract IDs from non-JSON output
  const lines = raw.split('\n').filter(Boolean);
  return lines.filter((l) => /^[a-z][a-z0-9-]*$/.test(l.trim()));
}

// ── Moon Run Output Filter ───────────────────────────────────────

const MAX_OUTPUT_LINES = 200;
const MAX_OUTPUT_CHARS = 16_000;

// Lines to keep (errors/warnings from common tools)
const ERROR_PATTERNS = [
  /^error/i,
  /: error /i,
  /^✗|^×|^✘|^❌/,
  /^FAIL/i,
  /\b(error|ERROR|Error)\b.*:/,
  /^\s+at\s+.+\(.+:\d+:\d+\)/, // stack frames
  /^(warning|WARNING|Warning)\b/i,
  /^⚠/,
  /deprecated/i,
];

// Lines to strip (progress/spinner/cache lines)
const STRIP_PATTERNS = [
  /^▮+ /, // moon progress bars: ▮▮▮▮ project:task
  /^\s*$/, // blank lines
  /\(cached[,)]/, // cached lines
  /Tasks: \d+ completed/, // task summary
  /^\s*Time: \d+ms/, // timing lines
  /❯❯❯❯ to the moon/, // moon ASCII art
];

function shouldKeep(line: string): boolean {
  if (line.length === 0) {
    return false;
  }
  return ERROR_PATTERNS.some((p) => p.test(line));
}

function shouldStrip(line: string): boolean {
  return STRIP_PATTERNS.some((p) => p.test(line));
}

/**
 * Filters moon run output to essential information.
 * Keeps error/warning lines, strips progress bars and cached entries.
 * Truncates with summary if output exceeds limits.
 */
export function filterMoonRunOutput(raw: string): string {
  if (!raw) {
    return '(no output)';
  }

  const allLines = raw.split('\n');
  const kept: string[] = [];
  let strippedCount = 0;

  for (const line of allLines) {
    if (shouldStrip(line)) {
      strippedCount++;
      continue;
    }
    kept.push(line);
  }

  // If filtered output is still large, apply smart truncation
  if (kept.length > MAX_OUTPUT_LINES || raw.length > MAX_OUTPUT_CHARS) {
    const errors = kept.filter(shouldKeep);
    const summary = kept.filter((l) => !shouldKeep(l)).slice(-30);

    let result = '';
    if (errors.length > 0) {
      result += `**Errors/Warnings (${errors.length})**:\n${errors.join('\n')}\n\n`;
    }
    result += `**Summary (last ${summary.length} lines of ${kept.length} total, ${strippedCount} stripped)**:\n${summary.join('\n')}`;

    if (errors.length === 0 && summary.length === 0) {
      return `${kept.slice(-20).join('\n')}\n\n(truncated from ${allLines.length} lines, ${strippedCount} progress lines stripped)`;
    }
    return result;
  }

  return kept.join('\n');
}

/**
 * Specific filter for fix (biome) output.
 */
export function filterFixOutput(raw: string): string {
  if (!raw) {
    return '(no output)';
  }

  // Biome fix output: keep lines with error counts or fix counts
  const lines = raw.split('\n');
  const kept = lines.filter((l) => {
    if (shouldStrip(l)) {
      return false;
    }
    if (l.includes('Fixed') || l.includes('applied') || l.includes('error')) {
      return true;
    }
    if (l.includes('Checked') || l.includes('files')) {
      return true;
    }
    return shouldKeep(l);
  });

  if (kept.length === 0) {
    return '✅ No issues fixed (clean)';
  }

  return kept.join('\n');
}

/**
 * Specific filter for typecheck (tsgo/tsc) output.
 */
export function filterTypecheckOutput(raw: string): string {
  if (!raw) {
    return '(no output)';
  }

  const lines = raw.split('\n');
  // TypeScript errors follow pattern: file.ts(line,col): error TS1234: message
  const errors = lines.filter((l) => /\.ts[x]?\s*\(\d+,\d+\):\s*error\s+TS/i.test(l));
  const warnings = lines.filter((l) => /\.ts[x]?\s*\(\d+,\d+\):\s*warning/i.test(l));
  const other = lines.filter(
    (l) => !shouldStrip(l) && !errors.includes(l) && !warnings.includes(l) && l.trim().length > 0,
  );

  if (errors.length === 0 && warnings.length === 0) {
    const nonEmpty = other.filter((l) => l.trim());
    if (nonEmpty.length === 0) {
      return '✅ Typecheck passed (no errors)';
    }
    return nonEmpty.slice(-5).join('\n');
  }

  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push(`**${errors.length} type error(s)**:`);
    parts.push(...errors.slice(0, 40));
    if (errors.length > 40) {
      parts.push(`... and ${errors.length - 40} more`);
    }
  }
  if (warnings.length > 0) {
    parts.push(`**${warnings.length} warning(s)**:`);
    parts.push(...warnings.slice(0, 10));
  }
  return parts.join('\n');
}

/**
 * Specific filter for test (bun:test) output.
 */
export function filterTestOutput(raw: string): string {
  if (!raw) {
    return '(no output)';
  }

  const lines = raw.split('\n');
  // Keep: pass/fail counts, test names, error lines
  const kept = lines.filter((l) => {
    if (shouldStrip(l)) {
      return false;
    }
    const trimmed = l.trim();
    if (!trimmed) {
      return false;
    }
    // Keep summary lines
    if (/(\d+)\s+(passed|failed|skipped|tests)/i.test(trimmed)) {
      return true;
    }
    // Keep error lines
    if (shouldKeep(l)) {
      return true;
    }
    // Keep test names
    if (/^✓|^✗|^✘|^PASS|^FAIL|^\d+\.\s/.test(trimmed)) {
      return true;
    }
    return false;
  });

  if (kept.length === 0) {
    return 'No test output captured.';
  }

  return kept.slice(-80).join('\n');
}

/**
 * Smart truncation for generic large output.
 * Shows first N lines + last N lines + line count.
 */
export function smartTruncate(raw: string, maxLines: number = 120): string {
  if (!raw) {
    return '(no output)';
  }

  const lines = raw.split('\n');
  if (lines.length <= maxLines) {
    return raw;
  }

  const head = lines.slice(0, 40);
  const tail = lines.slice(-40);

  return [
    ...head,
    `... ${lines.length - 80} lines truncated (${raw.length} chars total) ...`,
    ...tail,
  ].join('\n');
}

/**
 * Guess task type from moon target string.
 */
export function guessTaskType(target: string): 'fix' | 'typecheck' | 'build' | 'test' | 'other' {
  const task = target.split(':').pop() ?? '';
  if (task === 'fix' || task === 'lint') {
    return 'fix';
  }
  if (task === 'typecheck' || task === 'tc') {
    return 'typecheck';
  }
  if (task === 'build') {
    return 'build';
  }
  if (task === 'test' || task === 'e2e') {
    return 'test';
  }
  return 'other';
}

/**
 * Filter moon run output based on task type.
 */
export function filterByTaskType(raw: string, target: string): string {
  const taskType = guessTaskType(target);
  switch (taskType) {
    case 'fix':
      return filterFixOutput(raw);
    case 'typecheck':
      return filterTypecheckOutput(raw);
    case 'test':
      return filterTestOutput(raw);
    case 'build':
      // Build output: strip progress, keep errors + size summary
      return filterMoonRunOutput(raw);
    default:
      return smartTruncate(raw);
  }
}
