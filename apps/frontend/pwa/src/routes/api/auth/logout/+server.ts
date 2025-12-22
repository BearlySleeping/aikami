import { toRouteHref } from '$router'
import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import logger from '$logger'

export const GET: RequestHandler = ({ cookies, url }) => {
  logger.log('api/auth/logout:GET - User logging out')

  // Clear all auth-related cookies
  cookies.delete('__session', { path: '/' })

  // Clear any other auth cookies you might have
  // Add more cookie deletions here if needed

  logger.log('api/auth/logout:GET - Cookies cleared, redirecting to home')

  // Redirect to home page after logout
  throw redirect(
    302,
    toRouteHref('login', {
      pathParameters: undefined,
      queryParameters: undefined,
      url,
    }),
  )
}

export const POST: RequestHandler = ({ cookies, url: _url }) => {
  logger.log('api/auth/logout:POST - User logging out')

  // Clear all auth-related cookies
  cookies.delete('__session', { path: '/' })

  // Clear any other auth cookies you might have
  // Add more cookie deletions here if needed

  logger.log('api/auth/logout:POST - Cookies cleared')

  // Return success response for AJAX requests
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
