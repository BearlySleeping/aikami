// apps/frontend/client/src/routes/(dev)/dev/combat-enhancements/+page.ts
//
// Lightweight development redirect: the old Combat Enhancements fixture
// playground is now the fixtures mode of the consolidated workspace. No
// duplicate ViewModel, fixtures or simulation code lives behind this URL.
//
// Contract: combat debug workspace (execution prompt §9)

import { redirect } from '@sveltejs/kit';

/** Redirects the retired route to the fixtures mode of the workspace. */
export const load = (): never => {
  redirect(307, '/dev/combat?mode=fixtures');
};
