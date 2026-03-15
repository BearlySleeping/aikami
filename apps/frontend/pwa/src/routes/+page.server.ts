import { redirect } from '@sveltejs/kit';
import { toRouteHref } from '$router';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  throw redirect(
    302,
    locals.userSession
      ? toRouteHref('dashboard', {
          pathParameters: undefined,
          queryParameters: undefined,
          url,
        })
      : toRouteHref('login', {
          pathParameters: undefined,
          queryParameters: undefined,
          url,
        }),
  );
};
