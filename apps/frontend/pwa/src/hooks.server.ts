import { toDeviceData } from '@aikami/utils';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getUserSession } from '$lib/server/utils/auth.ts';
import logger from '$logger';
import { toRoutePathFromRouteId, toRoutePathFromURL } from '$router';

export const handleError = (({ error }) => {
  const pwaError = error as App.Error | undefined;
  // const errorId = randomUUID();

  logger.error('hooks.server:handleError', error);
  return {
    // errorId,
    message: pwaError?.message ?? 'Internal Server Error',
    type: pwaError?.type ?? 'unknown-error',
  };
}) satisfies HandleServerError;

export const handle = (async ({ event, resolve }) => {
  const { locals, request, route, url } = event;
  const { pathname } = url;
  const routeId = route.id;

  const { shouldReAuthenticate, userSession } = await getUserSession(event);

  logger.log('hooks:handle:getUserSession_result', {
    pathname: url.pathname,
    shouldReAuthenticate,
    userSessionExists: !!userSession,
  });
  locals.userSession = userSession;

  if (pathname.startsWith('/api/')) {
    const method = request.method;
    if (method !== 'POST') {
      return new Response('Method Not Allowed. Only POST or OPTIONS is allowed.', {
        headers: {
          'Access-Control-Allow-Headers':
            'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
          'Access-Control-Allow-Origin': '*',
          Allow: 'POST',
        },
        status: 405,
      });
    }

    const response = await resolve(event);
    return response;
  }

  const currentRoutePath = routeId ? toRoutePathFromRouteId(routeId) : toRoutePathFromURL(url);

  locals.currentRoutePath = currentRoutePath;

  const userAgent = request.headers.get('user-agent');
  if (!locals.device && userAgent) {
    const DeviceDetector = (await import('device-detector-js')).default;
    const deviceDetector = new DeviceDetector();
    locals.device = toDeviceData(deviceDetector.parse(userAgent));
  }

  // code above happens before the endpoint or page is called
  const response = await resolve(event);
  // code bellow happens after the endpoint or page is called

  // Note: Re-authentication logic can be added here if needed

  logger.log('hooks:route', {
    pathname: url.pathname,
    routeId,
  });

  logger.log('hooks:currentRoutePath', currentRoutePath);
  // Route groups now handle authentication logic
  // No need to manually check auth status here

  return response;
}) satisfies Handle;
