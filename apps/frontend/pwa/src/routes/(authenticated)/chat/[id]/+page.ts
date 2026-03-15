import { redirect } from '@sveltejs/kit';
import { logger } from '$logger';
import { toRouteHref } from '$router';
import type { PageLoad } from './$types';

export const load: PageLoad = (event) => {
  const { params } = event;

  const { id } = params;
  if (!id) {
    logger.error('No chat id provided');
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
