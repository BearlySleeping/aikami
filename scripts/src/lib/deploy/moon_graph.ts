// scripts/src/lib/deploy/moon_graph.ts
//
// Thin wrapper around `moon query projects` for code that needs the FULL
// project dependency graph — not "what changed" (moon's `--affected`
// filtering needs a git diff and is the wrong tool here; see
// resolve_deploy_apps.ts for that side of things).
//
// Used by cache.ts: a deploy app's deployment checksum has to include every
// moon project it transitively depends on, not just its own top-level
// directory — see the comment on computeAppChecksum in cache.ts for the
// incident this closes (a shared-package-only change was invisible to the
// old checksum, so checkDeployCache reported a cache HIT and silently
// skipped a build+deploy whose output would actually have differed).

import { runArgs } from './utils';

export type MoonProjectNode = {
  id: string;
  source: string;
  /** Direct dependency project ids only — resolveTransitiveSourcePaths walks these. */
  dependencies: string[];
};

let _graphCache: MoonProjectNode[] | null = null;

/**
 * Queries the full project graph (no --affected filter — every project in
 * the workspace, unconditionally) and returns each project's id, source
 * path, and direct dependency ids. Memoized per process: the graph is
 * static for the lifetime of a single CI job / deploy run.
 */
export function queryFullProjectGraph(): MoonProjectNode[] {
  if (_graphCache) {
    return _graphCache;
  }
  const output = runArgs(['bun', 'moon', 'query', 'projects'], { quiet: true });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('`moon query projects` produced no JSON output');
  }
  const parsed = JSON.parse(output.slice(jsonStart)) as {
    projects: Array<{ id: string; source: string; dependencies?: Array<{ id: string }> }>;
  };
  _graphCache = parsed.projects.map((p) => ({
    id: p.id,
    source: p.source,
    // Leaf projects with zero dependencies omit the field entirely rather
    // than returning an empty array.
    dependencies: (p.dependencies ?? []).map((d) => d.id),
  }));
  return _graphCache;
}

/**
 * Returns the transitive closure of dependency source paths for the moon
 * project whose source is `rootSourcePath` — every directory whose content
 * could change that project's build output, including its own. Falls back
 * to just `[rootSourcePath]` when moon doesn't know about that path (never
 * silently drop the app's own directory from the checksum).
 */
export function resolveTransitiveSourcePaths(
  rootSourcePath: string,
  graph: MoonProjectNode[] = queryFullProjectGraph(),
): string[] {
  const root = graph.find((p) => p.source === rootSourcePath);
  if (!root) {
    return [rootSourcePath];
  }

  const byId = new Map(graph.map((p) => [p.id, p] as const));
  const visitedIds = new Set<string>();
  const sourcePaths: string[] = [];
  const stack = [root.id];

  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (visitedIds.has(id)) {
      continue;
    }
    visitedIds.add(id);
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    sourcePaths.push(node.source);
    stack.push(...node.dependencies);
  }

  return sourcePaths;
}
