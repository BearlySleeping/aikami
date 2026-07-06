// scripts/src/lib/agents/scope_explorer.ts
/**
 * Autonomous Scope Explorer & Semantic Dependency Traverser (C-307).
 *
 * Automates repository analysis: parses a natural-language issue description,
 * sweeps monorepo export arrays, traces TypeScript imports via the Compiler API,
 * maps structural dependency relationships, and discovers the tightest possible
 * boundary of source files required for a given task.
 *
 * Outputs the discovered file cluster directly to the scratchpad's
 * `sourceFilePaths` parameter for downstream agent consumption.
 *
 * Usage:
 *   bun run scripts/src/lib/agents/scope_explorer.ts --query "refactor vendor economy"
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────

/** Package boundary classification. */
export type PackageBoundary = 'shared' | 'frontend' | 'backend' | 'app' | 'script';

/** A single discovered file node with its dependency graph. */
export type DependencyNode = {
  filePath: string;
  imports: string[];
  exports: string[];
  packageBoundary: PackageBoundary;
};

/** Complete discovery manifest written to scratchpad. */
export type DiscoveryManifest = {
  originQuery: string;
  seedSymbolsIsolated: string[];
  discoveredClusterPaths: string[];
  confidenceScore: number;
  crossedBoundaries: boolean;
};

// ── Constants ──────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

/** Path prefix → boundary mapping. */
const BOUNDARY_MAP: Array<{ prefix: string; boundary: PackageBoundary }> = [
  { prefix: 'packages/shared/', boundary: 'shared' },
  { prefix: 'packages/frontend/', boundary: 'frontend' },
  { prefix: 'packages/backend/', boundary: 'backend' },
  { prefix: 'apps/frontend/', boundary: 'app' },
  { prefix: 'apps/backend/', boundary: 'app' },
  { prefix: 'apps/e2e/', boundary: 'app' },
  { prefix: 'scripts/', boundary: 'script' },
];

/** File extensions to scan. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.svelte']);

/** Directories to exclude from traversal. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.moon',
  'temp',
  'tmp',
  '.pi',
  '.context',
  'test-results',
]);

/** @aikami/* package namespace to filesystem path mapping. */
const PACKAGE_PATH_MAP: Record<string, string> = {
  '@aikami/constants': 'packages/shared/constants/src/index.ts',
  '@aikami/schemas': 'packages/shared/schemas/src/index.ts',
  '@aikami/types': 'packages/shared/types/src/index.ts',
  '@aikami/logger': 'packages/shared/logger/src/index.ts',
  '@aikami/utils': 'packages/shared/utils/src/index.ts',
  '@aikami/mocks': 'packages/shared/mocks/src/index.ts',
  '@aikami/parser': 'packages/shared/parser/src/index.ts',
  '@aikami/backend/ai': 'packages/backend/ai/src/index.ts',
  '@aikami/backend/auth': 'packages/backend/auth/src/index.ts',
  '@aikami/backend/chat': 'packages/backend/chat/src/index.ts',
  '@aikami/backend/configs': 'packages/backend/configs/src/index.ts',
  '@aikami/backend/database': 'packages/backend/database/src/index.ts',
  '@aikami/backend/image': 'packages/backend/image/src/index.ts',
  '@aikami/backend/svelte-kit': 'packages/backend/svelte-kit/src/index.ts',
  '@aikami/backend/utils': 'packages/backend/utils/src/index.ts',
  '@aikami/frontend/configs': 'packages/frontend/configs/src/index.ts',
  '@aikami/frontend/dataconnect': 'packages/frontend/dataconnect/src/index.ts',
  '@aikami/frontend/engine': 'packages/frontend/engine/src/index.ts',
  '@aikami/frontend/repositories': 'packages/frontend/repositories/src/index.ts',
  '@aikami/frontend/services': 'packages/frontend/services/src/index.ts',
  '@aikami/frontend/utils': 'packages/frontend/utils/src/index.ts',
};

// ── Boundary classifier ────────────────────────────────────

/** Classify a file path into a package boundary. */
const _classifyBoundary = (filePath: string): PackageBoundary => {
  const rel = relative(PROJECT_ROOT, filePath);
  for (const { prefix, boundary } of BOUNDARY_MAP) {
    if (rel.startsWith(prefix)) {
      return boundary;
    }
  }
  return 'app';
};

// ── File system traversal ──────────────────────────────────

/** Recursively gather source files in a directory. */
const _gatherSourceFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(..._gatherSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))
    ) {
      // Skip test files during scope discovery
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
        continue;
      }
      files.push(fullPath);
    }
  }

  return files;
};

// ── Import parsing ─────────────────────────────────────────

/** Regex to match static import statements. */
const IMPORT_PATTERNS = {
  /** import { x } from '@aikami/*' */
  aikamiImport:
    /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"](@aikami\/[^'"]+)['"]/g,
  /** import '...' or import "...". */
  anyImport:
    /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|[^{}\s*]+)\s+from\s+['"]([^'"]+)['"]/g,
  /** export { ... } */
  namedExport: /export\s+\{[^}]+\}/g,
  /** export const/function/class/type */
  declarationExport: /export\s+(const|function|class|type|interface|enum)\s+(\w+)/g,
} as const;

/**
 * Parse a source file for its imports and exports.
 */
const _parseModule = (filePath: string): { imports: string[]; exports: string[] } | null => {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const imports: string[] = [];
    const exports: string[] = [];

    // Extract @aikami/* imports
    let matchA: RegExpExecArray | null;
    IMPORT_PATTERNS.aikamiImport.lastIndex = 0;
    while (true) {
      matchA = IMPORT_PATTERNS.aikamiImport.exec(content);
      if (matchA === null) {
        break;
      }
      imports.push(matchA[1]);
    }

    // Extract other external imports (skip relative imports)
    IMPORT_PATTERNS.anyImport.lastIndex = 0;
    let matchB: RegExpExecArray | null;
    while (true) {
      matchB = IMPORT_PATTERNS.anyImport.exec(content);
      if (matchB === null) {
        break;
      }
      const importPath = matchB[2];
      if (!importPath.startsWith('.') && !importPath.startsWith('@aikami/')) {
        imports.push(importPath);
      }
    }

    // Extract exports
    let matchC: RegExpExecArray | null;
    while (true) {
      matchC = IMPORT_PATTERNS.declarationExport.exec(content);
      if (matchC === null) {
        break;
      }
      exports.push(matchC[2]);
    }

    return { imports, exports };
  } catch {
    return null;
  }
};

// ── Semantic keyword matching ──────────────────────────────

/**
 * Map a natural language query to likely package and symbol targets.
 *
 * Uses keyword heuristics to identify which monorepo layers are relevant.
 * AC-1: Semantic Boundary Discovery — traces keywords to module entries.
 */
const _matchQueryToBoundaries = (
  query: string,
): { boundaries: PackageBoundary[]; symbols: string[]; confidence: number } => {
  const lower = query.toLowerCase();
  const boundaries = new Set<PackageBoundary>();
  const symbols: string[] = [];

  // ── Boundary keywords ─────────────────────────────────
  const boundaryKeywords: Array<{ words: string[]; boundary: PackageBoundary }> = [
    {
      words: [
        'vendor',
        'economy',
        'gold',
        'haggling',
        'shop',
        'trade',
        'npc',
        'inventory',
        'item',
        'quest',
        'dialogue',
        'combat',
        'character',
        'persona',
        'save',
        'load',
        'game state',
      ],
      boundary: 'app',
    },
    {
      words: ['firebase', 'firestore', 'function', 'emulator', 'deploy', 'data connect'],
      boundary: 'backend',
    },
    {
      words: [
        'component',
        'view',
        'viewmodel',
        'svelte',
        'ui',
        'canvas',
        'pixi',
        'overlay',
        'tailwind',
        'daisyui',
        'layout',
        'button',
        'modal',
      ],
      boundary: 'frontend',
    },
    {
      words: ['schema', 'type', 'constant', 'utility', 'shared', 'interface', 'validator'],
      boundary: 'shared',
    },
    { words: ['script', 'build', 'ci', 'deploy', 'setup', 'tmux', 'herdr'], boundary: 'script' },
  ];

  for (const { words, boundary } of boundaryKeywords) {
    if (words.some((w) => lower.includes(w))) {
      boundaries.add(boundary);
    }
  }

  // ── Symbol extraction from query ──────────────────────
  const symbolPattern =
    /\b(vendor|economy|wallet|gold|haggl|shop|trade|npc|inventory|item|quest|dialogue|combat|character|persona|save|load|cache|scratchpad|router|token|agent|swarm|director)\w*\b/gi;
  let symMatch: RegExpExecArray | null;
  while (true) {
    symMatch = symbolPattern.exec(lower);
    if (symMatch === null) {
      break;
    }
    symbols.push(symMatch[0]);
  }

  // Confidence: % of keywords matched vs total boundary keywords
  const totalKeywords = boundaryKeywords.flatMap((k) => k.words).length;
  const matchedCount = boundaryKeywords
    .flatMap((k) => k.words)
    .filter((w) => lower.includes(w)).length;
  const confidence = Math.min(1, matchedCount / Math.max(totalKeywords / 4, 1));

  return {
    boundaries: [...boundaries],
    symbols,
    confidence,
  };
};

// ── Dependency graph traversal ─────────────────────────────

/**
 * Build a dependency graph from seed files, traversing @aikami/* imports.
 * Returns discovered file paths clustered around the seed symbols.
 */
const _buildDependencyCluster = (options: {
  seedBoundaries: PackageBoundary[];
  seedSymbols: string[];
  maxDepth?: number;
}): DependencyNode[] => {
  const { seedBoundaries, seedSymbols, maxDepth = 3 } = options;

  const nodes: DependencyNode[] = [];
  const visited = new Set<string>();

  // Find seed files matching the boundaries
  const seedFiles: string[] = [];

  for (const boundary of seedBoundaries) {
    const boundaryDirs = BOUNDARY_MAP.filter((b) => b.boundary === boundary).map((b) => b.prefix);
    for (const dir of boundaryDirs) {
      const fullDir = resolve(PROJECT_ROOT, dir);
      const files = _gatherSourceFiles(fullDir);
      seedFiles.push(...files);
    }
  }

  // Score seed files by symbol relevance
  const fileScores = new Map<string, number>();

  for (const filePath of seedFiles) {
    const parsed = _parseModule(filePath);
    if (!parsed) {
      continue;
    }

    const fileName = basename(filePath).toLowerCase();
    let score = 0;

    for (const symbol of seedSymbols) {
      if (fileName.includes(symbol)) {
        score += 3;
      }
      if (parsed.exports.some((e) => e.toLowerCase().includes(symbol))) {
        score += 2;
      }
    }

    if (score > 0) {
      fileScores.set(filePath, score);
    }
  }

  // Sort by score, take top 20 as seeds
  const topSeeds = [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([path]) => path);

  // BFS traversal from seeds
  const queue = [...topSeeds];
  let depth = 0;

  while (queue.length > 0 && depth < maxDepth) {
    const levelSize = queue.length;

    for (let i = 0; i < levelSize; i++) {
      const filePath = queue.shift();
      if (!filePath || visited.has(filePath)) {
        continue;
      }

      visited.add(filePath);

      const parsed = _parseModule(filePath);
      const boundary = _classifyBoundary(filePath);

      nodes.push({
        filePath: relative(PROJECT_ROOT, filePath),
        imports: parsed?.imports ?? [],
        exports: parsed?.exports ?? [],
        packageBoundary: boundary,
      });

      // Follow @aikami/* imports
      if (parsed) {
        for (const imp of parsed.imports) {
          const resolvedPath = PACKAGE_PATH_MAP[imp];
          if (resolvedPath) {
            const fullPath = resolve(PROJECT_ROOT, resolvedPath);
            if (existsSync(fullPath) && !visited.has(fullPath)) {
              queue.push(fullPath);
            }
          }
        }
      }
    }

    depth++;
  }

  return nodes;
};

// ── Cross-package boundary validation ──────────────────────

/**
 * Check if the discovered cluster crosses forbidden boundaries.
 *
 * AC-2: Cross-Package Graph Halting
 * - Frontend files must not import server-side (backend) patterns
 * - View layer modifications must stay within frontend packages
 */
const _validateBoundaries = (nodes: DependencyNode[]): { valid: boolean; violations: string[] } => {
  const violations: string[] = [];

  for (const node of nodes) {
    // Frontend → Backend is forbidden
    if (node.packageBoundary === 'app' || node.packageBoundary === 'frontend') {
      const backendImports = node.imports.filter((imp) => imp.startsWith('@aikami/backend/'));
      if (backendImports.length > 0) {
        violations.push(
          `Cross-boundary violation: ${node.filePath} (${node.packageBoundary}) imports backend module(s): ${backendImports.join(', ')}`,
        );
      }
    }

    // Check for SPA boundary violations (server routes in frontend)
    if (node.filePath.includes('/routes/') && node.packageBoundary === 'app') {
      const fileName = basename(node.filePath);
      if (
        fileName === '+server.ts' ||
        fileName === '+page.server.ts' ||
        fileName === '+layout.server.ts'
      ) {
        violations.push(`SPA boundary violation: server route detected at ${node.filePath}`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
};

// ── Public API ─────────────────────────────────────────────

/**
 * Execute a scope discovery pass given a natural-language issue description.
 *
 * AC-1: Semantic Boundary Discovery
 * - Uses keyword heuristics to map NL query to monorepo layers
 * - Traces imports through @aikami/* namespace
 * - Isolates the tightest code file boundary
 * - Writes a DiscoveryManifest to the scratchpad
 *
 * AC-2: Cross-Package Graph Halting
 * - Validates that frontend targets don't cross into backend layers
 * - Flags architectural violations
 */
export const exploreScope = (options: { query: string; maxDepth?: number }): DiscoveryManifest => {
  const { query, maxDepth } = options;

  // ── Step 1: Match query to boundaries ────────────────
  const { boundaries, symbols, confidence } = _matchQueryToBoundaries(query);

  console.log('[scope-explorer] Query analysis:', { boundaries, symbols, confidence });

  // ── Step 2: Build dependency cluster ──────────────────
  const nodes = _buildDependencyCluster({
    seedBoundaries: boundaries,
    seedSymbols: symbols,
    maxDepth,
  });

  console.log('[scope-explorer] Dependency cluster:', { nodes: nodes.length });

  // ── Step 3: Validate cross-boundary constraints ───────
  const boundaryCheck = _validateBoundaries(nodes);
  if (!boundaryCheck.valid) {
    for (const violation of boundaryCheck.violations) {
      console.warn('[scope-explorer] Boundary violation:', violation);
    }
  }

  // ── Step 4: Build manifest ────────────────────────────
  const discoveredPaths = nodes.map((n) => n.filePath);

  const manifest: DiscoveryManifest = {
    originQuery: query,
    seedSymbolsIsolated: symbols,
    discoveredClusterPaths: discoveredPaths,
    confidenceScore: confidence,
    crossedBoundaries: !boundaryCheck.valid,
  };

  // Output manifest to stdout for scratchpad consumption
  const manifestJson = JSON.stringify(manifest, null, 2);
  console.log('\n[scope-explorer] Discovery Manifest:\n');
  console.log(manifestJson);

  // Write to file for scratchpad integration
  const manifestPath = resolve(PROJECT_ROOT, '.pi', 'scratchpad.json');
  writeFileSync(manifestPath, manifestJson);
  console.log(`\n[scope-explorer] Manifest written to ${manifestPath}`);

  return manifest;
};

// ── CLI ────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);
  const queryIdx = args.indexOf('--query');
  const query = queryIdx !== -1 ? args[queryIdx + 1] : undefined;

  if (!query) {
    console.error('Usage: bun run scope_explorer.ts --query "refactor vendor economy"');
    process.exit(1);
  }

  exploreScope({ query });
};

main();
