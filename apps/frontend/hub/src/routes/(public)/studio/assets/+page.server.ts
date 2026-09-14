// apps/frontend/hub/src/routes/(public)/studio/assets/+page.server.ts
//
// C-522 — Hub Studio → Generation page load.
//
// Session-gated, like every other generation surface: the load calls the same
// `handleListRunners` the API route calls, with the page request, so the
// ownership rule is enforced in exactly one place. An anonymous visitor still
// gets a rendered page (the surface says "sign in"), never a 500 or a redirect
// loop — and a deployment without D1 degrades to a stated "unconfigured".
//
// 🔴 The Hub is SSR; unlike the client, server routes here are correct, and this
// page deliberately does not duplicate the client's `/studio/assets`.

import type { RunnerDeviceSummary } from '@aikami/types';
import { handleListRunners, resolveGenerationRunnerEnv } from '$lib/server/api';
import { getWorkerEnv } from '$lib/server/worker_env.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ request }) => {
  const env = resolveGenerationRunnerEnv(getWorkerEnv());
  if (!env) {
    // Generation is additive and never a boot dependency: degrade to a stated
    // surface rather than failing the navigation.
    return { configured: false, signedIn: false, devices: [] as RunnerDeviceSummary[] };
  }
  const response = await handleListRunners(request, env);
  if (!response.ok) {
    // 401 is the ordinary "not signed in" path, not an error page.
    return { configured: true, signedIn: false, devices: [] as RunnerDeviceSummary[] };
  }
  return {
    configured: true,
    signedIn: true,
    devices: (await response.json()) as RunnerDeviceSummary[],
  };
};
