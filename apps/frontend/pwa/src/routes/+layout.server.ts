import type { LogLevel } from '@aikami/types/index.ts';
import type { RouteName } from '$router.ts';
import type { PWAHookData } from '$types/index.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
  const { locals, url } = event;
  const { currentRoutePath, device, userSession } = locals;
  const { searchParams } = url;
  const logLevelParam = searchParams.get('logLevel') ?? undefined;

  const logLevel = logLevelParam as LogLevel;

  return {
    currentRoutePath: currentRoutePath as RouteName | undefined,
    device,
    logLevel,
    userSession,
  } satisfies PWAHookData;
};
