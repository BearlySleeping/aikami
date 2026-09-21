// .pi/extensions/lib/import_boundary.test.ts
//
// 🔴 THE EXTENSION IMPORT BOUNDARY — the whole point of this file.
//
// pi loads every `.pi/extensions/*.ts` under Node (its bin is
// `#!/usr/bin/env node`; the `npmCommand: ["bun"]` setting in
// .pi/settings.json only chooses the package *installer*). Anything an
// extension statically imports therefore executes under Node, where Bun
// globals, Bun-only packages, and tsconfig path aliases do not exist.
//
// The architecture is therefore: extensions import *types and pure constants
// only*, and reach every piece of runtime behavior through the bridge
// (./bridge.ts → `bun run scripts/src/lib/pi/index.ts <command>`). This guard
// enforces that mechanically, so the rule is not just remembered:
//
//   1. Any value import from outside `.pi` must be a runtime dependency
//      (node:/bun: builtin or `@earendil-works/*` / `typebox`) or a pure
//      constants module (`packages/shared/constants`). Everything else must
//      be `import type` / `export type`.
//   2. No extension source may reference the `Bun` global — it does not exist
//      under the Node runtime pi uses in production.

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const PI_ROOT = resolve(REPO_ROOT, '.pi');
const EXTENSIONS_DIR = resolve(PI_ROOT, 'extensions');

/** Every `.ts` file under `.pi/extensions`, recursively. */
const collectExtensions = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectExtensions(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
};

/** Runtime dependency specifiers an extension may import for its value. */
const isAllowedDependency = (specifier: string): boolean =>
  /^(node:|bun:)/.test(specifier) ||
  specifier.startsWith('@earendil-works/') ||
  /^typebox(\/|$)/.test(specifier);

/** Pure constants packages an extension may import for their value. */
const isAllowedConstants = (specifier: string): boolean =>
  specifier === '@aikami/constants' || specifier.includes('/packages/shared/constants/');

type ImportStatement = {
  /** The statement head (from the previous `from` up to this one). */
  statement: string;
  specifier: string;
  line: number;
};

/**
 * Blank out comments while preserving string/template contents and overall
 * length. Import specifiers live inside quotes, so they must survive; prose in
 * comments (e.g. `guessing from "the output stopped changing"`) must not be
 * mistaken for an import.
 */
const stripComments = (source: string): string => {
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
      result += c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          result += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        result += source[i];
        i++;
      }
      if (i < n) {
        result += source[i];
        i++;
      }
      continue;
    }
    result += c;
    i++;
  }
  return result;
};

const FROM_PATTERN = /^[ \t]*(?:import|export)\b[\w\s{},*]*?\bfrom[ \t]*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_PATTERN = /^[ \t]*import\s+['"]([^'"]+)['"]/gm;
const CALL_FORM_PATTERN = /\b(import|require)\s*\(\s*([\x22\x27])([^\x22\x27]+)\2\s*\)/g;

/** Type-only when the statement head is `import type` / `export type`. */
const isTypeOnly = (statement: string): boolean => /\b(?:import|export)\s+type\b/.test(statement);

const lineOf = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
};

/** True for `import()` used as a TypeScript type rather than a runtime load. */
const isTypePositionImport = (source: string, index: number): boolean => {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const head = source.slice(lineStart, index);
  return (
    /^\s*(?:export\s+)?type\b.*=\s*$/.test(head) ||
    /(?:^|[,(])\s*[\w$]+\??:\s*$/.test(head) ||
    /\b(?:as|extends|implements|keyof|satisfies|typeof)\s+(?:unknown\s+as\s+)?$/.test(head)
  );
};

/** Parse static imports plus runtime `import('<x>')` and `require('<x>')` calls. */
const parseImports = (source: string): ImportStatement[] => {
  const stripped = stripComments(source);
  const found: ImportStatement[] = [];
  for (const match of stripped.matchAll(FROM_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      found.push({
        statement: match[0],
        specifier,
        line: lineOf(stripped, match.index ?? 0),
      });
    }
  }
  for (const match of stripped.matchAll(SIDE_EFFECT_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      found.push({ statement: 'import', specifier, line: lineOf(stripped, match.index ?? 0) });
    }
  }
  for (const match of stripped.matchAll(CALL_FORM_PATTERN)) {
    const index = match.index ?? 0;
    const call = match[1];
    const specifier = match[3];
    if (specifier && (call === 'require' || !isTypePositionImport(stripped, index))) {
      found.push({ statement: 'runtime import', specifier, line: lineOf(stripped, index) });
    }
  }
  return found;
};

/** A relative specifier is local when it resolves inside the `.pi` directory. */
const isLocalPiImport = (file: string, specifier: string): boolean => {
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolved = resolve(dirname(file), specifier).split(sep).join('/');
  const piRoot = PI_ROOT.split(sep).join('/');
  return resolved === piRoot || resolved.startsWith(`${piRoot}/`);
};

/** Apply the production extension import-boundary policy to one parsed entry. */
const isViolation = (file: string, entry: ImportStatement): boolean => {
  if (isTypeOnly(entry.statement)) {
    return false;
  }
  if (isAllowedDependency(entry.specifier) || isAllowedConstants(entry.specifier)) {
    return false;
  }
  return !isLocalPiImport(file, entry.specifier);
};

/** Lines using the `Bun` global, ignoring comments. */
const bunGlobalUses = (file: string): string[] => {
  const offenders: string[] = [];
  let inBlockComment = false;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (inBlockComment) {
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        return;
      }
      if (trimmed.startsWith('/*')) {
        inBlockComment = !trimmed.includes('*/');
        return;
      }
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) {
        return;
      }
      const code = trimmed.replace(/\/\/.*$/, '');
      if (/(?<![\w$.])Bun\s*[.[]/.test(code)) {
        offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
      }
    });
  return offenders;
};

const extensionFiles = collectExtensions(EXTENSIONS_DIR);
// Tests themselves run under Bun; only production extension code must be Node-safe.
const runtimeExtensionFiles = extensionFiles.filter((file) => !file.endsWith('.test.ts'));

describe('pi extensions import only types and pure constants from outside .pi', () => {
  it('finds the extensions to check', () => {
    // Guards the guard: a bad directory would make every case vacuously pass.
    expect(extensionFiles.length).toBeGreaterThan(10);
  });

  for (const file of extensionFiles) {
    it(relative(REPO_ROOT, file), () => {
      const source = readFileSync(file, 'utf8');
      const violations = parseImports(source)
        .filter((entry) => isViolation(file, entry))
        .map((entry) => `${relative(REPO_ROOT, file)}:${entry.line}  ${entry.specifier}`);
      expect(violations, 'value imports outside .pi must be deps or constants').toEqual([]);
    });
  }
});

describe('pi extensions never reference the Bun global', () => {
  for (const file of runtimeExtensionFiles) {
    it(relative(REPO_ROOT, file), () => {
      expect(bunGlobalUses(file)).toEqual([]);
    });
  }
});

describe('import boundary detector', () => {
  it('flags a value import of a script module but allows its type form', () => {
    const fixtureFile = join(EXTENSIONS_DIR, 'boundary_fixture.ts');
    const source = [
      "import { startServices } from '../../scripts/src/lib/herdr/session';",
      "import type { DevService } from '../../scripts/src/lib/herdr/session';",
      "const dynamic = await import('../../scripts/src/lib/herdr/session');",
      "const required = require('../../scripts/src/lib/herdr/session');",
      "type Session = import('../../scripts/src/lib/herdr/session').Session;",
      "import { PORTS } from '../../packages/shared/constants/src/lib/development_ports';",
      "import { join } from 'node:path';",
      "import { Type } from 'typebox';",
      "import { runPiScript } from './lib/bridge.ts';",
    ].join('\n');

    const violations = parseImports(source).filter((entry) => isViolation(fixtureFile, entry));
    expect(violations.map((entry) => entry.specifier)).toEqual([
      '../../scripts/src/lib/herdr/session',
      '../../scripts/src/lib/herdr/session',
      '../../scripts/src/lib/herdr/session',
    ]);
  });
});
