// packages/backend/discord-bot/src/lib/github_issue.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors GitHub's REST API JSON keys (html_url, X-GitHub-Api-Version)
//
// Opens a GitHub issue from a #bugs-features-requests forum thread, once a
// Moderator/Admin reviews it and @mentions the bot. Extended to take
// arbitrary `labels` (derived from the thread's forum tag) instead of a
// fixed 'bug'|'feature' enum, since a forum thread might carry a "Question"
// tag with no GitHub-issue label at all.
//
// Auth: GITHUB_ISSUES_TOKEN — a fine-grained PAT scoped to ONLY
// `issues:write` on this repo. Never reuse a broader token here.

const REPO = 'BearlySleeping/aikami';

export type CreateIssueInput = {
  title: string;
  body: string;
  labels: string[];
  token: string;
};

export type CreateIssueResult = { htmlUrl: string; number: number };

export async function createGithubIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
  const { title, body, labels, token } = input;

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'aikami-discord-bot',
    },
    body: JSON.stringify({ title, body, labels: [...labels, 'from-discord'] }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(
      `GitHub issue creation failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }

  const json = (await res.json()) as { html_url: string; number: number };
  return { htmlUrl: json.html_url, number: json.number };
}
