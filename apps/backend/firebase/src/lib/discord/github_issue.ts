// apps/backend/firebase/src/discord/github_issue.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors GitHub's REST API JSON keys (html_url, X-GitHub-Api-Version)
//
// Opens a GitHub issue from a Discord /bug or /feature modal submission.
// Plain fetch against the REST API — this repo avoids pulling in Octokit
// for one or two calls (same reasoning as scripts/src/lib/discord/: raw
// fetch, no SDK, see discord_notify.ts / notification.ts for prior art).
//
// Auth: GITHUB_ISSUES_TOKEN — a fine-grained PAT scoped to ONLY
// `issues:write` on this repo. Never reuse a broader token here; this
// endpoint is reachable by anyone who can run a Discord slash command.

const REPO = 'BearlySleeping/aikami';

export type CreateIssueInput = {
  kind: 'bug' | 'feature';
  title: string;
  description: string;
  reporterUsername: string;
  token: string;
};

export type CreateIssueResult = { htmlUrl: string; number: number };

export async function createGithubIssueFromDiscord(
  input: CreateIssueInput,
): Promise<CreateIssueResult> {
  const { kind, title, description, reporterUsername, token } = input;

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'aikami-discord-bot',
    },
    body: JSON.stringify({
      title,
      body: `${description}\n\n---\n_Reported via Discord by @${reporterUsername}_`,
      labels: [kind === 'bug' ? 'bug' : 'enhancement', 'from-discord'],
    }),
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
