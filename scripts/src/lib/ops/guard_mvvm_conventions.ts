// scripts/src/lib/ops/guard_mvvm_conventions.ts
//
// Structural guards for the Svelte MVVM conventions documented in
// .pi/skills/svelte-conventions/SKILL.md — enforced by CI, not just by
// convention. Scans every `*_view.svelte` and `*_view_model.svelte.ts` under
// apps/frontend/client and apps/frontend/hub.
//
//   View rules (*_view.svelte):
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
//
// Usage: bun scripts/src/lib/ops/guard_mvvm_conventions.ts
// Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');
const APP_ROOTS = [
  resolve(ROOT, 'apps/frontend/client/src'),
  resolve(ROOT, 'apps/frontend/hub/src'),
];

type Violation = { file: string; rule: string; message: string };

const violations: Violation[] = [];

const relPath = (file: string): string => file.replace(`${ROOT}/`, '');

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
      rule: 'V1',
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

  if (/(^|\n)\s*(export\s+)?(async\s+)?function\s+\w+\s*\(/.test(script)) {
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
    `\n🔴 mvvm-conventions guard failed — ${violations.length} violation(s) across ${byFile.size} file(s)`,
  );
  process.exit(1);
}

console.log('✅ mvvm-conventions guard passed — all views and view-models are compliant');
