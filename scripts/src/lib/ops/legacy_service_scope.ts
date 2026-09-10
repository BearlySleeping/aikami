// scripts/src/lib/ops/legacy_service_scope.ts
//
// Dependency-aware scope for guard_service_mock_coverage.
//
// The preload globally replaces the client `$services` barrel, so any module
// reachable from a Bun-lane test that imports a name from `$services` crashes
// at link time if the preload mock lacks that name. That reachable set — not
// the entire barrel — is the legacy scope the guard must enforce.
//
// Migrated features (features with their own explicit composition + a Vitest
// browser test) do not use the preload, so their services are never in the
// reachable set and never need a preload entry. That is the whole point: the
// guard stops forcing designers of new features to extend the legacy mock.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Comment stripper that preserves string contents (import specifiers survive). */
export const stripComments = (source: string): string => {
  let result = '';
  let index = 0;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') {
        result += ' ';
        index++;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      if (index < length) {
        result += '  ';
        index += 2;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      result += char;
      index++;
      while (index < length && source[index] !== quote) {
        if (source[index] === '\\') {
          result += source[index] + (source[index + 1] ?? '');
          index += 2;
          continue;
        }
        result += source[index];
        index++;
      }
      if (index < length) {
        result += source[index];
        index++;
      }
      continue;
    }
    result += char;
    index++;
  }
  return result;
};

/** Strips comments AND string contents (for structural matching where strings are irrelevant). */
export const stripStringsAndComments = (source: string): string => {
  let result = '';
  let index = 0;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') {
        result += ' ';
        index++;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      if (index < length) {
        result += '  ';
        index += 2;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      result += ' ';
      index++;
      while (index < length && source[index] !== quote) {
        if (source[index] === '\\') {
          result += '  ';
          index += 2;
          continue;
        }
        result += source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      if (index < length) {
        result += ' ';
        index++;
      }
      continue;
    }
    result += char;
    index++;
  }
  return result;
};

const CLIENT_ALIASES: Record<string, string> = {
  $lib: 'lib',
  $services: 'lib/services',
  $components: 'lib/components',
  $types: 'lib/types',
  $utils: 'lib/utils',
  $views: 'lib/views',
  $i18n: 'lib/utils/i18n',
};

// Static imports/re-exports only. Dynamic `import()` is deliberately excluded:
// it only evaluates when executed, so a never-taken branch must not make a
// service a hard legacy dependency (and following it produced false positives
// against branches that are never executed under the Bun lane).
const IMPORT_SPECIFIER_RE = /(?:from\s+|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

const SERVICES_BARREL_RE =
  /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]\$services['"]/g;

/** Returns the runtime barrel export names a module imports/re-exports from `$services`. */
export const extractServicesExportNames = (content: string): string[] => {
  const names = new Set<string>();
  const stripped = stripComments(content);
  for (const match of stripped.matchAll(SERVICES_BARREL_RE)) {
    // `import type { ... }` / `export type { ... }` vanish at runtime.
    if (/^(?:import|export)\s+type\s*\{/.test(match[0])) {
      continue;
    }
    for (const rawEntry of (match[1] ?? '').split(',')) {
      const entry = rawEntry.trim();
      if (!entry || entry.startsWith('type ')) {
        continue;
      }
      const original = entry.split(/\s+as\s+/)[0]?.trim();
      if (original) {
        names.add(original);
      }
    }
  }
  return [...names];
};

const resolveCandidate = (
  base: string,
  fileExists: (file: string) => boolean,
): string | undefined =>
  [base, `${base}.ts`, `${base}.svelte.ts`, `${base}.svelte`, `${base}/index.ts`].find(fileExists);

/** Resolves a client-internal import specifier to a file path; external → undefined. */
export const resolveClientSpecifier = (options: {
  fromFile: string;
  specifier: string;
  clientSrcRoot: string;
  fileExists: (file: string) => boolean;
}): string | undefined => {
  const { fromFile, specifier, clientSrcRoot, fileExists } = options;
  if (specifier.startsWith('.')) {
    return resolveCandidate(resolve(dirname(fromFile), specifier), fileExists);
  }
  if (specifier === '$services') {
    return resolveCandidate(resolve(clientSrcRoot, 'lib/services/index'), fileExists);
  }
  if (specifier.startsWith('$services/')) {
    return resolveCandidate(
      resolve(clientSrcRoot, 'lib/services', specifier.slice('$services/'.length)),
      fileExists,
    );
  }
  const alias = Object.keys(CLIENT_ALIASES).find(
    (key) => specifier === key || specifier.startsWith(`${key}/`),
  );
  if (alias) {
    const rest = specifier === alias ? '' : specifier.slice(alias.length + 1);
    return resolveCandidate(resolve(clientSrcRoot, CLIENT_ALIASES[alias], rest), fileExists);
  }
  return undefined;
};

/** Walks the client-internal module graph reachable from the given entry files. */
export const collectReachableClientFiles = (options: {
  entryFiles: readonly string[];
  clientSrcRoot: string;
  readFile: (file: string) => string;
  fileExists: (file: string) => boolean;
}): Set<string> => {
  const { entryFiles, clientSrcRoot, readFile, fileExists } = options;
  const visited = new Set<string>();
  const queue = [...entryFiles];
  const rootPrefix = clientSrcRoot.endsWith('/') ? clientSrcRoot : `${clientSrcRoot}/`;
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file) || !file.startsWith(rootPrefix)) {
      continue;
    }
    visited.add(file);
    let content: string;
    try {
      content = stripComments(readFile(file));
    } catch {
      continue;
    }
    for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
      const resolved = resolveClientSpecifier({
        fromFile: file,
        specifier: match[1] ?? '',
        clientSrcRoot,
        fileExists,
      });
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return visited;
};

/** Barrel exports imported from `$services` by any file reachable from the entries. */
export const collectRequiredServiceExports = (options: {
  entryFiles: readonly string[];
  clientSrcRoot: string;
  readFile: (file: string) => string;
  fileExists: (file: string) => boolean;
}): string[] => {
  const files = collectReachableClientFiles(options);
  const names = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = options.readFile(file);
    } catch {
      continue;
    }
    for (const name of extractServicesExportNames(content)) {
      names.add(name);
    }
  }
  return [...names].sort();
};

/** Required legacy exports with no matching preload mock key. */
export const computeUncoveredRequiredExports = (
  required: Iterable<string>,
  mockKeys: ReadonlySet<string>,
): string[] => [...required].filter((name) => !mockKeys.has(name)).sort();

/**
 * Enforceable legacy scope: the explicit inventory of `$services` exports the
 * legacy preload must mock. An entry that lost its mock is a real regression;
 * an entry that is no longer a barrel export must be pruned (ratchet).
 */
export type InventoryViolations = {
  missingMocks: string[];
  notBarrelExports: string[];
};

export const computeInventoryViolations = (options: {
  inventory: Iterable<string>;
  mockKeys: ReadonlySet<string>;
  barrelExports: ReadonlySet<string>;
}): InventoryViolations => {
  const missingMocks: string[] = [];
  const notBarrelExports: string[] = [];
  for (const name of options.inventory) {
    if (!options.barrelExports.has(name)) {
      notBarrelExports.push(name);
    } else if (!options.mockKeys.has(name)) {
      missingMocks.push(name);
    }
  }
  return { missingMocks: missingMocks.sort(), notBarrelExports: notBarrelExports.sort() };
};

/** Node defaults, so the guard does not re-implement file access. */
export const nodeReadFile = (file: string): string => readFileSync(file, 'utf8');
export const nodeFileExists = (file: string): boolean => existsSync(file);
