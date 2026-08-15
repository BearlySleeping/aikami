// apps/frontend/hub/src/routes/(public)/+layout.server.ts
//
// Public group layout (C-396 AC-1): renders for ANYONE — signed in or not.
// Never redirects. The session is passed through so the app shell can show
// the account menu (signed-in) or the login affordance (anonymous); the
// shell renders fine with `userSession === undefined`.
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return {
    userSession: locals.userSession,
  };
};
