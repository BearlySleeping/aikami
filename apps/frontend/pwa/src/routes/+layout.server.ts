import type { RouteName } from '$router'
import type { PWAHookData } from '$types'
import type { LayoutServerLoad } from './$types'
import type { LogLevel } from '@aikami/types'

export const load: LayoutServerLoad = (event) => {
  const { locals, url } = event
  const {
    currentRoutePath,
    device,
    userSession,
  } = locals
  const { searchParams } = url
  const logLevelParam = searchParams.get('logLevel') ?? undefined

  const logLevel = logLevelParam as LogLevel

  return {
    currentRoutePath: currentRoutePath as RouteName | undefined,
    device,
    logLevel,
    userSession,
  } satisfies PWAHookData
}
