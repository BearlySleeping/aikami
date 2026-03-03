import { redirect } from '@sveltejs/kit';
import { toRouteHref } from '$router.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.userSession) {
    throw redirect(
      302,
      toRouteHref('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
        url,
      }),
    );
  } else {
    throw redirect(
      302,
      toRouteHref('login', {
        pathParameters: undefined,
        queryParameters: undefined,
        url,
      }),
    );
  }
};
