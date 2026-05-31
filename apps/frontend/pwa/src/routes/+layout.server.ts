// apps/frontend/pwa/src/routes/+layout.server.ts
import type { LogLevel } from '@aikami/types';
import type { PWAHookData } from '$types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
  const { locals, url } = event;
  const { currentRoute, device, userSession, sessionId } = locals;
  const { searchParams } = url;

  const logLevelParam = searchParams.get('logLevel') ?? undefined;
  const logLevel = logLevelParam as LogLevel;

  return {
    currentRoute,
    device,
    logLevel,
    sessionId,
    userSession,
  } satisfies PWAHookData;
};
