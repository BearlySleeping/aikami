// scripts/src/lib/ops/guards/evidence_matrix.ts
//
// Contract Evidence Matrix ingestion for the orphaned-capability guard.
//
// A symbol named by a contract's Evidence Matrix "Production Path" counts as
// in-use, because a contract can legitimately land the wiring in a later PR and
// deleting the capability in the meantime would be wrong.
//
// 🔴 This is a deliberate, DOCUMENTATION-DRIVEN seam, and therefore weaker than
// a code reference: editing a markdown table can silence an orphan. It is kept
// because removing it today would ADD recorded debt, and adding debt is a
// policy change requiring human review. Two things keep it honest:
//
//   • the guard reports every symbol it rescues in `--show-all`, so a reviewer
//     sees exactly which capabilities are held open by prose rather than code;
//   • the parse is narrow — a Production Path cell only, in a real Evidence
//     Matrix table, resolved against a file that must exist.
//
// It lives in its own module rather than inside the guard so the seam is
// visible as a seam: a reader can see it is one file, one exported function, and
// nothing else depends on it.
//
// Follow-up: replace it with an explicit, reviewed baseline entry per rescued
// symbol, so the reason is recorded as accepted debt instead of re-derived from
// a document on every run.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export type EvidenceMatrixOptions = {
  /** Absolute path to `docs/contracts`. */
  contractsDir: string;
  /** Absolute path to the client services directory. */
  servicesDir: string;
  /** Repo root, for resolving a Production Path that is not services-relative. */
  root: string;
  /** Directory names never walked. */
  excludedDirs: ReadonlySet<string>;
  /** Service files to search when resolving a class name. */
  serviceFiles: readonly string[];
  /** Classes reachable from an exported `XService.create(...)` singleton. */
  exportedServiceClasses: (sourceFile: ts.SourceFile) => Set<string>;
};

/** A symbol named by a Production Path cell, with the file it resolves to. */
type ResolvedSymbol = { symbol: string; file: string };

/**
 * Extracts the Production Path cell of every row in every Evidence Matrix table
 * in a contract document.
 *
 * Table detection is structural (a header row starting with `AC`, then a
 * separator row, then data rows) rather than a blanket regex over the file, so
 * a Production Path mentioned in prose is not mistaken for a declared path.
 */
export const collectProductionPaths = (content: string): string[] => {
  const paths: string[] = [];
  const matrixRegex = /\*\*Evidence Matrix\*\*[\s\S]*?(?=\n## |$)/gi;

  for (const matrixMatch of content.matchAll(matrixRegex)) {
    let inTable = false;
    for (const line of matrixMatch[0].split('\n')) {
      const kind = rowKind({ line, inTable });
      if (kind === 'header') {
        inTable = true;
        continue;
      }
      if (kind === 'separator') {
        continue;
      }
      if (kind === 'end') {
        inTable = false;
        continue;
      }
      const productionPath = productionPathOf(line);
      if (productionPath) {
        paths.push(productionPath);
      }
    }
  }

  return paths;
};

/** Which kind of table line this is, given whether a table is already open. */
const rowKind = (input: {
  line: string;
  inTable: boolean;
}): 'header' | 'separator' | 'end' | 'data' => {
  if (/^\|\s*AC\b/.test(input.line)) {
    return 'header';
  }
  if (input.inTable && /^\|\s*-/.test(input.line)) {
    return 'separator';
  }
  if (!input.inTable || !input.line.trim().startsWith('|')) {
    return 'end';
  }
  return 'data';
};

/**
 * The Production Path cell of a table row, or `undefined` when the row declares
 * none (`N/A`, or an empty cell).
 *
 * `split('|')` retains the leading empty cell, so Production Path is index 4.
 */
const productionPathOf = (line: string): string | undefined => {
  const cell = line.split('|').map((part) => part.trim())[4] ?? '';
  return cell && cell !== 'N/A' ? cell : undefined;
};

/** Recursively looks for a file whose path ends with `fileRef`. */
const walkForFilename = (options: {
  dir: string;
  fileRef: string;
  excludedDirs: ReadonlySet<string>;
}): string | null => {
  try {
    for (const entry of readdirSync(options.dir, { withFileTypes: true })) {
      const fullPath = resolve(options.dir, entry.name);
      if (entry.isDirectory()) {
        if (options.excludedDirs.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        const found = walkForFilename({ ...options, dir: fullPath });
        if (found) {
          return found;
        }
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(options.fileRef)) {
        return fullPath;
      }
    }
  } catch {
    // Skip inaccessible directories.
  }
  return null;
};

/** Resolves a Production Path's `file.ts` reference to an absolute path. */
const resolveFileRef = (options: EvidenceMatrixOptions, fileRef: string): string | null => {
  for (const candidate of [resolve(options.servicesDir, fileRef), resolve(options.root, fileRef)]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return walkForFilename({
    dir: options.servicesDir,
    fileRef,
    excludedDirs: options.excludedDirs,
  });
};

/** Finds the service file that exports a given class name. */
const findServiceFileForClass = (
  options: EvidenceMatrixOptions,
  className: string,
): string | null => {
  for (const filePath of options.serviceFiles) {
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
      );
      if (options.exportedServiceClasses(sourceFile).has(className)) {
        return filePath;
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return null;
};

/**
 * Resolves one Production Path cell to a symbol and its declaring file.
 *
 * Two forms are supported: `file.ts#exportedSymbol`, and `ClassName.methodName`
 * resolved by finding the file that exports the class. Anything else — prose, a
 * URL, a bare filename — resolves to nothing.
 */
export const resolveProductionPath = (
  options: EvidenceMatrixOptions,
  productionPath: string,
): ResolvedSymbol | undefined => {
  const fileSymbolMatch = productionPath.match(/([\w./-]+\.[jt]sx?)#(\w+)/);
  if (fileSymbolMatch) {
    const file = resolveFileRef(options, fileSymbolMatch[1] ?? '');
    return file === null ? undefined : { symbol: fileSymbolMatch[2] ?? '', file };
  }

  const classMethodMatch = productionPath.match(/\b([A-Z]\w+)\.(\w+)\b/);
  if (!classMethodMatch) {
    return undefined;
  }
  const className = classMethodMatch[1] ?? '';
  const file = findServiceFileForClass(options, className);
  return file === null ? undefined : { symbol: `${className}.${classMethodMatch[2] ?? ''}`, file };
};

/**
 * Parse contract Evidence Matrices and extract symbols from Production Path
 * cells, as `symbol → declaring files`.
 */
export const evidenceMatrixSymbols = (options: EvidenceMatrixOptions): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>();

  let contractFiles: string[];
  try {
    contractFiles = readdirSync(options.contractsDir).filter(
      (file) => /^(C|MIG)-\d+/.test(file) && file.endsWith('.md'),
    );
  } catch {
    return result;
  }

  for (const filename of contractFiles) {
    let content: string;
    try {
      content = readFileSync(resolve(options.contractsDir, filename), 'utf-8');
    } catch {
      continue;
    }

    for (const productionPath of collectProductionPaths(content)) {
      const resolved = resolveProductionPath(options, productionPath);
      if (!resolved) {
        continue;
      }
      const files = result.get(resolved.symbol) ?? new Set<string>();
      files.add(resolved.file);
      result.set(resolved.symbol, files);
    }
  }

  return result;
};
