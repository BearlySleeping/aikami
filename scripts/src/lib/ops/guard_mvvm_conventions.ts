// scripts/src/lib/ops/guard_mvvm_conventions.ts
//
// Structural guards for the Svelte MVVM conventions documented in
// .pi/skills/svelte-conventions/SKILL.md — enforced by CI, not just by
// convention. Scans every `*_view.svelte` and `*_view_model.svelte.ts` under
// apps/frontend/client and apps/frontend/hub.
//
//   View rules (*_view.svelte):
//     V0  The <script> block must declare `lang="ts"`.
//     V1  A view with a `viewModel` prop must wrap its markup in
//         BaseViewModelContainer (imported from the app's `$components`
//         barrel). Exempt: views with no `viewModel` prop (pure
//         presentational sub-components) and views whose entire markup is a
//         <svelte:head> block (nothing to wrap — svelte:head must stay
//         top-level and can't be nested inside another component).
//     V2  No `@aikami/constants` / `$constants` imports — labels/constants
//         are the ViewModel's job to expose.
//     V3  No service imports (`$services`, `$lib/services/*`,
//         `@aikami/frontend/services`) — views talk to the ViewModel only.
//     V4  No `function` declarations in the <script> block.
//     V5  No <style> block — prefer Tailwind utility classes.
//
//     V6  No `$effect` — Views are completely logicless (Pillar 3).
//         RATCHET (see below) — 19 pre-existing violations across 13 files.
//     V7  No `onMount` / `onDestroy` — lifecycle belongs to
//         BaseViewModelContainer. RATCHET — 8 violations across 8 files.
//
//   ViewModel rules (*_view_model.svelte.ts):
//     M1  Exports a `${Name}ViewModelOptions` type.
//     M2  Exports a `${Name}ViewModelInterface` type.
//     M3  The class extends BaseViewModel.
//     M4  Exported via the declared ViewModel class's
//         `ClassName.create(options)` factory — never `new ClassName(`.
//     M5  Service imports come from the `$services` barrel, never
//         `$lib/services/*` direct paths.
//     M6  No `$logger` import — BaseViewModel provides this.debug() etc.
//     M7  No arrow-function class-field methods — regular methods only, so
//         `this`/`super` and create()'s auto-logging keep working.
//     M8  A ViewModel may not import another ViewModel — stops the VM graph
//         collapsing into spaghetti. RATCHET — 52 violations across 15 files.
//     M9  No `await import()` outside the documented allowlist
//         (svelte-conventions/SKILL.md's dynamic-import table). RATCHET —
//         RATCHET — 40 violations across 20 files.
//
// V6, V7, M8, M9 are RATCHETS, not hard-zero gates: each has pre-existing
// violations that are weeks of rewrite work, not a one-sitting fix. Per-file
// counts are captured in guard_mvvm_conventions_baseline.json and may only
// go DOWN — see guard_type_safety.ts for the identical mechanism. V0–V5 and
// M1–M7 have zero pre-existing violations and stay hard gates (any
// occurrence fails immediately, no baseline).
//
// Usage:
//   bun scripts/src/lib/ops/guard_mvvm_conventions.ts
//   bun scripts/src/lib/ops/guard_mvvm_conventions.ts --update-baseline
// Exits non-zero on any hard-rule violation, any ratchet exceeding its
// baseline, or any ratchet improvement not yet locked in via
// --update-baseline.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');
const APP_ROOTS = [
  resolve(ROOT, 'apps/frontend/client/src'),
  resolve(ROOT, 'apps/frontend/hub/src'),
];
const BASELINE_PATH = resolve(import.meta.dir, 'guard_mvvm_conventions_baseline.json');

type Violation = { file: string; rule: string; message: string };
type RatchetRule = 'v6' | 'v7' | 'm8' | 'm9';
type RatchetCounts = Record<RatchetRule, number>;
type Baseline = Record<string, RatchetCounts>;

const RATCHET_RULES: RatchetRule[] = ['v6', 'v7', 'm8', 'm9'];
const emptyCounts = (): RatchetCounts => ({ v6: 0, v7: 0, m8: 0, m9: 0 });

const violations: Violation[] = [];
const ratchetViolations: Violation[] = [];

const relPath = (file: string): string => file.replace(`${ROOT}/`, '').split(sep).join('/');

// Blanks out comments and string/template literal contents (preserving
// newlines) so V4's `function` check never fires on the word `function`
// inside a string or template literal.
const stripStringsAndComments = (source: string): string => {
  let result = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && c2 === '*') {
      result += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        result += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      result += ' ';
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          result += '  ';
          i += 2;
          continue;
        }
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        result += ' ';
        i++;
      }
      continue;
    }
    result += c;
    i++;
  }
  return result;
};

const walk = (dir: string, matches: (name: string) => boolean): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.svelte-kit' || entry === 'build') {
      continue;
    }
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, matches));
    } else if (matches(entry)) {
      out.push(full);
    }
  }
  return out;
};

// ── View rules ───────────────────────────────────────────────────────────

const checkView = (file: string): void => {
  const content = readFileSync(file, 'utf8');
  const scriptMatches = [...content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const scriptMatch =
    scriptMatches.find(
      (match) => !/\bmodule\b|\bcontext\s*=\s*['"]module['"]/i.test(match[1] ?? ''),
    ) ?? scriptMatches[0];
  const scriptAttributes = scriptMatch?.[1] ?? '';
  const script = scriptMatch?.[2] ?? '';
  const markup = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  if (scriptMatch && !/\blang\s*=\s*(['"])ts\1/i.test(scriptAttributes)) {
    violations.push({
      file: relPath(file),
      rule: 'V0',
      message: 'uses a <script> block without lang="ts"',
    });
  }

  const hasViewModelProp = /viewModel\??:\s*\w+ViewModelInterface/.test(script);
  const renderedMarkup = markup.replace(/<svelte:head[^>]*>[\s\S]*?<\/svelte:head>/gi, '').trim();
  // <svelte:window> and head-only components must be top-level — strip them
  // before checking the container wrapper.
  const markupForContainer = renderedMarkup
    .replace(/^<svelte:window[\s\S]*?\/>/m, '')
    .replace(/^<HeadTagsView[^>]*\/>/m, '')
    .replace(/^<HeadTagsViewModel[^>]*\/>/m, '')
    .replace(/^[\s\n]*/, '')
    .trim();
  const directContainerPattern =
    /^<BaseViewModelContainer\b(?=[^>]*(?:\{viewModel\}|viewModel\s*=\s*\{viewModel\}))[^>]*>[\s\S]*<\/BaseViewModelContainer>$/.test(
      markupForContainer,
    );
  const guardedContainerPattern =
    /^\{#if\s+viewModel}\s*<BaseViewModelContainer\b(?=[^>]*(?:\{viewModel\}|viewModel\s*=\s*\{viewModel\}))[^>]*>[\s\S]*<\/BaseViewModelContainer>\s*{\/if}$/.test(
      markupForContainer,
    );
  const wrapsViewModel = directContainerPattern || guardedContainerPattern;
  if (hasViewModelProp && markupForContainer && !wrapsViewModel) {
    violations.push({
      file: relPath(file),
      rule: 'V1',
      message: 'has a viewModel prop but does not wrap markup in <BaseViewModelContainer>',
    });
  }

  if (/@aikami\/constants|from ['"]\$constants/.test(script)) {
    violations.push({ file: relPath(file), rule: 'V2', message: 'imports constants directly' });
  }

  if (
    /from ['"]\$services['"]|from ['"]\$lib\/services\/|from ['"]@aikami\/frontend\/services['"]/.test(
      script,
    )
  ) {
    violations.push({ file: relPath(file), rule: 'V3', message: 'imports a service directly' });
  }

  if (/(^|\n)\s*(export\s+)?(async\s+)?function\s+\w+\s*\(/.test(stripStringsAndComments(script))) {
    violations.push({
      file: relPath(file),
      rule: 'V4',
      message: 'declares a function in <script>',
    });
  }

  if (/<style[\s>]/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'V5',
      message: 'has a <style> block — prefer Tailwind classes',
    });
  }

  const strippedScript = stripStringsAndComments(script);
  const effectCount = strippedScript.match(/\$effect\s*\(/g)?.length ?? 0;
  for (let i = 0; i < effectCount; i++) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'V6',
      message: 'uses `$effect` — Views are completely logicless (Pillar 3)',
    });
  }
  const lifecycleCount = strippedScript.match(/\bonMount\s*\(|\bonDestroy\s*\(/g)?.length ?? 0;
  for (let i = 0; i < lifecycleCount; i++) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'V7',
      message: 'uses onMount/onDestroy — lifecycle belongs to BaseViewModelContainer',
    });
  }
};

// ── ViewModel rules ──────────────────────────────────────────────────────

const checkViewModel = (file: string): void => {
  const content = readFileSync(file, 'utf8');
  const base = file.split('/').pop() ?? '';
  const nameMatch = base.match(/^(.*)_view_model\.svelte\.ts$/);
  if (!nameMatch) {
    return;
  }

  if (!/export type \w*ViewModelOptions\s*=/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'M1',
      message: 'missing exported `*ViewModelOptions` type',
    });
  }
  if (!/export type \w*ViewModelInterface\s*=/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'M2',
      message: 'missing exported `*ViewModelInterface` type',
    });
  }
  if (!/extends \w+ViewModel[<(]/.test(content) && !/extends \w+ViewModel\b/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'M3',
      message: 'class does not extend BaseViewModel',
    });
  }
  const className = content.match(/\bclass\s+(\w+ViewModel)\s+extends\s+\w+ViewModel\b/)?.[1];
  const hasClassFactory =
    className !== undefined &&
    new RegExp(
      `export\\s+const\\s+\\w+\\s*=\\s*[\\s\\S]{0,800}?=>\\s*${className}\\.create\\s*\\(`,
    ).test(content);
  if (!hasClassFactory) {
    violations.push({
      file: relPath(file),
      rule: 'M4',
      message: 'missing an exported factory that invokes the declared ViewModel class `.create()`',
    });
  }
  if (className && new RegExp(`new\\s+${className}\\s*\\(`).test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'M4',
      message: 'instantiates the ViewModel with `new` instead of `.create()`',
    });
  }
  if (/from ['"]\$lib\/services\//.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'M5',
      message: 'imports a service from `$lib/services/*` instead of the `$services` barrel',
    });
  }
  if (/from ['"]\$logger['"]/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'M6',
      message: 'imports `$logger` — use inherited this.debug()/this.error() instead',
    });
  }

  // M7: arrow-function class-field methods. Matches `name = (...) => {` (or
  // `async (...) =>`) at class-body indentation, excluding $state/$derived
  // assignments (those are reactive fields, not methods).
  const arrowMethodRe =
    /^\s{2,}(?:private |protected |public |override )?_?\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+?)?=>\s*\{/gm;
  for (const match of content.matchAll(arrowMethodRe)) {
    const line = match[0];
    if (/\$state|\$derived/.test(line)) {
      continue;
    }
    violations.push({
      file: relPath(file),
      rule: 'M7',
      message: `arrow-function class-field method (breaks this/super): \`${line.trim()}\``,
    });
  }

  const strippedContent = stripStringsAndComments(content);
  const vmImportCount =
    strippedContent.match(/from ['"][^'"]*_view_model(\.svelte)?['"]/g)?.length ?? 0;
  for (let i = 0; i < vmImportCount; i++) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'M8',
      message: 'imports another ViewModel — a ViewModel may not depend on another ViewModel',
    });
  }

  // M9 allowlist: dynamic imports that are explicitly permitted.
  // See svelte-conventions/SKILL.md dynamic-import table.
  const allowlistPatterns = [
    /@aikami\/frontend\/engine/,
    /onnxruntime-web/,
    /kokoro-js/,
    /pixi\.js/,
    /@tauri-apps/,
    /\?worker&type=module/,
    /eruda/,
  ];
  const dynamicImportMatches = strippedContent.match(/\bawait\s+import\s*\(/g) ?? [];
  const dynamicImportCount = dynamicImportMatches.length;
  // Count non-allowlisted dynamic imports by checking if any remain after
  // removing allowlisted ones. This is a heuristic — we count all dynamic
  // imports and subtract those that appear to be allowlisted.
  const allowlistedCount = allowlistPatterns.reduce((count, pattern) => {
    const matches = strippedContent.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
  const effectiveCount = Math.max(0, dynamicImportCount - allowlistedCount);
  for (let i = 0; i < effectiveCount; i++) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'M9',
      message:
        'uses `await import()` — only valid per the allowlist in svelte-conventions/SKILL.md',
    });
  }
};

// ── Ratchet baseline I/O ─────────────────────────────────────────────────

const loadBaseline = (): Baseline => {
  if (!existsSync(BASELINE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
};

const countsOf = (relPathValue: string): RatchetCounts => {
  const counts = emptyCounts();
  for (const v of ratchetViolations) {
    if (v.file === relPathValue) {
      counts[v.rule.toLowerCase() as RatchetRule]++;
    }
  }
  return counts;
};

// ── Main ─────────────────────────────────────────────────────────────────

for (const root of APP_ROOTS) {
  for (const file of walk(root, (n) => n.endsWith('_view.svelte'))) {
    checkView(file);
  }
  for (const file of walk(root, (n) => n.endsWith('_view_model.svelte.ts'))) {
    checkViewModel(file);
  }
}

if (violations.length > 0) {
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
  }
  for (const [file, vs] of byFile) {
    console.error(`❌ ${file}`);
    for (const v of vs) {
      console.error(`      [${v.rule}] ${v.message}`);
    }
  }
  console.error(
    `\n🔴 mvvm-conventions guard failed — ${violations.length} hard violation(s) across ${byFile.size} file(s)`,
  );
  process.exit(1);
}

const updateBaseline = Bun.argv.includes('--update-baseline');
const ratchetFiles = [...new Set(ratchetViolations.map((v) => v.file))].sort();

if (updateBaseline) {
  const baseline: Baseline = {};
  for (const file of ratchetFiles) {
    baseline[file] = countsOf(file);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`✅ Baseline updated: ${ratchetFiles.length} file(s) with ratcheted violations`);
  process.exit(0);
}

const baseline = loadBaseline();
const allRatchetPaths = new Set([...ratchetFiles, ...Object.keys(baseline)]);

let ratchetFailed = false;
for (const file of [...allRatchetPaths].sort()) {
  const current = countsOf(file);
  const expected = baseline[file] ?? emptyCounts();
  const lines: string[] = [];

  for (const rule of RATCHET_RULES) {
    if (current[rule] > expected[rule]) {
      ratchetFailed = true;
      lines.push(
        `[${rule.toUpperCase()}] ${current[rule]} found, baseline allows ${expected[rule]}`,
      );
    } else if (current[rule] < expected[rule]) {
      ratchetFailed = true;
      lines.push(
        `[${rule.toUpperCase()}] improved to ${current[rule]} (baseline ${expected[rule]}) — run --update-baseline to lock this in`,
      );
    }
  }

  if (lines.length > 0) {
    console.error(`❌ ${file}`);
    for (const line of lines) {
      console.error(`      ${line}`);
    }
  }
}

if (ratchetFailed) {
  console.error('\n🔴 mvvm-conventions ratchet guard failed — see violations above');
  process.exit(1);
}

console.log('✅ mvvm-conventions guard passed — all views and view-models are compliant');
