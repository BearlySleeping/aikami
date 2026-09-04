// apps/frontend/hub/src/lib/server/api/account_sessions.ts
//
// C-464 AC-10: Session management endpoints — revoke all sessions through
// Better Auth's own session API rather than deleting `sessions` rows directly.

import { logger } from '$logger';
import { getBetterAuth } from './better_auth.ts';

/**
 * POST /api/account/sessions/revoke-all
 *
 * Session-verified. Revokes every session for the current user through
 * Better Auth's own session API, including the caller's own session.
 * The current device will be signed out and must sign in again.
 *
 * This goes through Better Auth's revokeSession API rather than deleting
 * `sessions` rows directly, because Better Auth owns session lifecycle
 * and reaching around it invites drift (C-464 OQ-3).
 */
export const handleRevokeAllSessions = async (request: Request): Promise<Response> => {
  const auth = getBetterAuth();
  if (!auth) {
    return new Response(JSON.stringify({ error: 'auth_unconfigured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    // listSessions returns all sessions for the current user.
    const sessions = await auth.api.listSessions({
      headers: request.headers,
    });

    let revokedCount = 0;
    let failedCount = 0;
    for (const s of sessions) {
      try {
        await auth.api.revokeSession({
          headers: request.headers,
          body: { token: s.token },
        } as never);
        revokedCount++;
      } catch (error) {
        failedCount++;
        logger.error(JSON.stringify({ event: 'sessions:revoke-failed', error: String(error) }));
      }
    }

    if (failedCount > 0) {
      return new Response(
        JSON.stringify({ error: 'incomplete', revoked: revokedCount, failed: failedCount }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ revoked: revokedCount }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    logger.error(JSON.stringify({ event: 'sessions:revoke-all-failed', error: String(error) }));
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
