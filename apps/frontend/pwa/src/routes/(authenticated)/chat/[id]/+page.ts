import { redirect } from '@sveltejs/kit';
import { toRouteHref } from '$router.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = (event) => {
  const { params } = event;

  const { id } = params;
  if (!id) {
    return redirect(
      307,
      toRouteHref('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
        url: event.url,
      }),
    );
  }

  return {
    id,
  };
};
