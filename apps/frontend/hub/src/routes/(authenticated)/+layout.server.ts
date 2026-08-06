import { redirect } from '@sveltejs/kit';
import { toRouteHref } from '$router';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const userSession = locals.userSession;

  // The hub is a community app — any signed-in user is welcome.
  if (!userSession) {
    throw redirect(
      302,
      toRouteHref('login', {
        pathParameters: undefined,
        queryParameters: undefined,
        setRedirectTo: true,
        url,
      }),
    );
  }

  return {
    user: userSession,
  };
};
