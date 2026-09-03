// scripts/src/lib/ops/guard_image_component.ts
//
// C-455: enforces the shared `Image` component (packages/frontend/components
// -> $components) as the single source of truth for <img> across the
// frontend apps, instead of raw <img> tags. Tauri's COOP/COEP headers
// (app.security.headers in tauri.conf.json) require every cross-origin
// image load to carry crossorigin="anonymous" or it gets silently blocked —
// the Image component defaults that on so no caller has to remember it.
// packages/frontend/components/src/lib/image/image.svelte is the one place
// allowed to render a raw <img>.
//
// Usage: bun scripts/src/lib/ops/guard_image_component.ts
// Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const SCAN_ROOTS = [
  resolve(ROOT, 'apps/frontend/client/src'),
  resolve(ROOT, 'apps/frontend/hub/src'),
];
const ALLOWED_FILE = resolve(ROOT, 'packages/frontend/components/src/lib/image/image.svelte');

const relPath = (file: string): string => file.replace(`${ROOT}/`, '');

const walk = (dir: string): string[] => {
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
      out.push(...walk(full));
    } else if (entry.endsWith('.svelte')) {
      out.push(full);
    }
  }
  return out;
};

const violations: { file: string; line: number }[] = [];

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    if (file === ALLOWED_FILE) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    // Matches an <img tag, including multiline tags, but not components like
    // <ImageFoo or <Image. Derive each report line from the full-source match.
    for (const match of source.matchAll(/<img[\s/>]/g)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({ file: relPath(file), line });
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    const message = 'raw <img> tag, use <Image> from $components instead';
    console.error(`❌ ${v.file}:${v.line} — ${message}`);
    annotate({ file: v.file, line: v.line, message, title: 'image-component guard' });
  }
  console.error(
    `\n🔴 image-component guard failed — ${violations.length} raw <img> tag(s). See .pi/skills/aikami-ui/SKILL.md.`,
  );
  process.exit(1);
}

console.log('✅ image-component guard passed — no raw <img> tags outside the Image component');
