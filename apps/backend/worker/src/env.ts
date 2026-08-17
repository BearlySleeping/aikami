// apps/backend/worker/src/env.ts
//
// Generic env loader: given a list of required keys, returns them from
// process.env — falling back to Secret Manager (fetchSecret) for whatever
// isn't already set. Local dev: put them in a `.env` file (Bun loads it
// automatically), so this never touches the network. Production (this VM):
// none of these are passed via --container-env, so they're always missing
// from process.env there, which is exactly the signal to fetch them using
// the VM's own identity. Not tied to any one worker's key set — each
// worker (e.g. @aikami/backend-discord-bot) declares its own required keys.

import { fetchSecret } from './secrets';

export async function loadEnv<Key extends string>(
  keys: readonly Key[],
): Promise<Record<Key, string>> {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const fetched = await Promise.all(
      missing.map(async (key) => [key, await fetchSecret(key)] as const),
    );
    for (const [key, value] of fetched) {
      process.env[key] = value;
    }
  }

  const env = {} as Record<Key, string>;
  for (const key of keys) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing required env var: ${key}`);
    }
    env[key] = value;
  }
  return env;
}
