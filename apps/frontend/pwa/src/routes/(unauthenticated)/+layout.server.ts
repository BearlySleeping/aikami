import { toRouteHref } from '$router'
import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'
import logger from '$logger'

export const load: LayoutServerLoad = ({ locals, url }) => {
  const { userSession } = locals

  logger.log('(unauthenticated) layout server load', {
    hasUserSession: !!userSession,
    pathname: url.pathname,
  })

  // If user is already authenticated, redirect to dashboard
  if (userSession) {
    logger.log('User already authenticated, redirecting to dashboard')
    throw redirect(
      302,
      toRouteHref('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
        url,
      }),
    )
  }

  // User is not authenticated, allow access to unauthenticated pages
  return {}
}
