import { redirect } from '@sveltejs/kit';
import { logger } from '$logger';
import { toRouteHref } from '$router';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
  const { userSession } = locals;

  logger.log('(authenticated) layout server load', {
    hasUserSession: !!userSession,
    pathname: url.pathname,
  });

  // If no user session, redirect to login with return URL
  if (!userSession) {
    logger.log('No user session, redirecting to login');
    throw redirect(
      302,
      toRouteHref('login', {
        pathParameters: undefined,
        queryParameters: undefined,
        url,
        setRedirectTo: true,
      }),
    );
  }

  // User is authenticated, return user data
  return {
    user: userSession,
  };
};
