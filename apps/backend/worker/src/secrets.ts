// apps/backend/worker/src/secrets.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors GCE metadata server / Secret Manager JSON keys (access_token, Authorization)
//
// Fetches a secret from GCP Secret Manager using this Compute Engine VM's
// attached service account — via the metadata server for a short-lived
// access token, then a plain REST call. No @google-cloud/secret-manager
// SDK, matching this repo's "plain fetch, no SDK" convention for anything
// backed by a handful of REST calls (see scripts/src/lib/discord/,
// packages/backend/discord-bot/src/lib/github_issue.ts). Nothing sensitive
// ever sits in VM instance metadata or --container-env — the VM's identity
// (IAM, via its attached service account) is the only thing exposed there.
//
// Generic on purpose: whatever worker(s) this app starts declare which
// keys they need (see env.ts), this module only knows how to fetch one.

const METADATA_BASE = 'http://metadata.google.internal/computeMetadata/v1';
const METADATA_HEADERS = { 'Metadata-Flavor': 'Google' } as const;

async function metadataGet(path: string): Promise<string> {
  const res = await fetch(`${METADATA_BASE}${path}`, {
    headers: METADATA_HEADERS,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`GCE metadata request failed: ${path} (${res.status})`);
  }
  return res.text();
}

async function getAccessToken(): Promise<string> {
  const json = await metadataGet('/instance/service-accounts/default/token');
  return (JSON.parse(json) as { access_token: string }).access_token;
}

async function getProjectId(): Promise<string> {
  return metadataGet('/project/project-id');
}

/** Fetches the latest version of `name` from Secret Manager in the VM's own GCP project. */
export async function fetchSecret(name: string): Promise<string> {
  const [token, projectId] = await Promise.all([getAccessToken(), getProjectId()]);
  const res = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${name}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) {
    throw new Error(`Secret Manager fetch failed for "${name}": ${res.status}`);
  }
  const json = (await res.json()) as { payload: { data: string } };
  return Buffer.from(json.payload.data, 'base64').toString('utf8');
}
