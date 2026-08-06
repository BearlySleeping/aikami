// apps/frontend/site/src/lib/data/github_stats.ts
/**
 * Build-time GitHub stats for the marketing site.
 *
 * Fetched once during `astro build` and rendered into the HTML — there is no
 * client-side fetch, so there's no flash of "★ --" placeholder dashes and no
 * rate-limit dependence in the browser. Falls back to `null` on any failure;
 * a missing counter is better than a fake one.
 */

export type RepoStats = {
  stars: number | null;
  openFeatures: number | null;
};

const REPO = 'BearlySleeping/aikami';

// biome-ignore lint/style/useNamingConvention: GitHub API returns snake_case fields
type RepoApi = { stargazers_count?: number };
// biome-ignore lint/style/useNamingConvention: GitHub API returns snake_case fields
type IssuesApi = { total_count?: number };

let cached: RepoStats | null = null;

export async function getRepoStats(): Promise<RepoStats> {
  if (cached) {
    return cached;
  }
  const api = 'https://api.github.com';
  try {
    const [repoRes, issuesRes] = await Promise.all([
      fetch(`${api}/repos/${REPO}`, { signal: AbortSignal.timeout(4_000) }),
      fetch(`${api}/search/issues?q=is:issue+state:open+label:feature+repo:${REPO}`, {
        signal: AbortSignal.timeout(4_000),
      }),
    ]);
    const repoRaw = repoRes.ok ? ((await repoRes.json()) as RepoApi) : null;
    const issuesRaw = issuesRes.ok ? ((await issuesRes.json()) as IssuesApi) : null;
    cached = {
      stars: typeof repoRaw?.stargazers_count === 'number' ? repoRaw.stargazers_count : null,
      openFeatures: typeof issuesRaw?.total_count === 'number' ? issuesRaw.total_count : null,
    };
  } catch {
    cached = { stars: null, openFeatures: null };
  }
  return cached;
}

/** Format a count compactly: 1250 → "1.2k", 42 → "42". */
export function formatCount(count: number): string {
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(count);
}
