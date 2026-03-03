import { toDeviceData } from '@aikami/utils/index.ts';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getUserSession } from '$lib/server/utils/auth.ts';
import logger from '$logger/index.ts';
import { toRoutePathFromRouteId, toRoutePathFromURL } from '$router.ts';

const TEST_MODE_HEADER = 'x-test-mode';
const TEST_USER_ID_HEADER = 'x-test-user-id';
const TEST_USER_EMAIL_HEADER = 'x-test-user-email';
const TEST_USER_NAME_HEADER = 'x-test-user-name';

const isTestMode = (request: Request): boolean => {
  return request.headers.get(TEST_MODE_HEADER) === 'true' || process.env.NODE_ENV === 'test';
};

const createTestUserSession = (request: Request) => {
  const userId = request.headers.get(TEST_USER_ID_HEADER) || 'test-user-123';
  const email = request.headers.get(TEST_USER_EMAIL_HEADER) || 'test@example.com';
  const name = request.headers.get(TEST_USER_NAME_HEADER) || 'Test User';

  return {
    id: userId,
    displayName: name,
    email: email,
    emailVerified: true,
    photoURL: undefined,
    disabled: false,
    customClaims: {},
    userRole: 'member' as const,
    status: 'active' as const,
    preferredLocale: 'en' as const,
    currentSignInProvider: 'email' as const,
  };
};

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

  let userSession;

  if (isTestMode(request)) {
    logger.log('hooks:testMode', { pathname });
    userSession = createTestUserSession(request);
  } else {
    const { shouldReAuthenticate, userSession: sessionFromAuth } = await getUserSession(event);
    userSession = sessionFromAuth;
  }

  logger.log('hooks:handle:getUserSession_result', {
    pathname: url.pathname,
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
