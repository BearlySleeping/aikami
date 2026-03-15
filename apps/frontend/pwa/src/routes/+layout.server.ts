import type { LogLevel } from '@aikami/types';
import type { PWAHookData } from '$types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
  const { locals, url } = event;
  const { currentRoute, device, userSession } = locals;
  const { searchParams } = url;

  const logLevelParam = searchParams.get('logLevel') ?? undefined;
  const logLevel = logLevelParam as LogLevel;

  return {
    currentRoute,
    device,
    logLevel,
    userSession,
  } satisfies PWAHookData;
};
