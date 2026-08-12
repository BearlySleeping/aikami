import { redirect } from '@sveltejs/kit';
import { toRouteHref } from '$router';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (locals.userSession?.userRole === 'superAdmin') {
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
