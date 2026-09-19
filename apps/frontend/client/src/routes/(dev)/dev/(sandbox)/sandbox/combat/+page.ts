// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/combat/+page.ts
//
// Lightweight development redirect: the old real-world/mock-combat hybrid
// sandbox is superseded by the production-backed live mode of the
// consolidated workspace. The retired `sandbox_combat.json` asset no longer
// exists, so this URL previously failed its map load; redirecting here removes
// the stale path rather than restoring a deleted asset.
//
// Contract: combat debug workspace (execution prompt §9)

import { redirect } from '@sveltejs/kit';

/** Redirects the retired sandbox route to the live mode of the workspace. */
export const load = (): never => {
  redirect(307, '/dev/combat?mode=live');
};
