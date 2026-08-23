import { redirect } from '@sveltejs/kit';
import { toRouteHref } from '$router';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // Any authenticated user is redirected away from the login page to the
  // dashboard. (The hub is a community app — every Better Auth user is a
  // `member`, so gating this on `superAdmin` would strand signed-in users on
  // the login page after the Google OAuth callback returns here.)
  if (locals.userSession) {
    throw redirect(
      302,
      toRouteHref('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
        url,
      }),
    );
  }
  return {};
};
