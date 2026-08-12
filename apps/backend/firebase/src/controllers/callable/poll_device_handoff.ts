// apps/backend/firebase/src/controllers/callable/poll_device_handoff.ts

import { pollDeviceHandoff } from '@aikami/backend/auth';
import type { CallableFunctions } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { onCall } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * Per-instance token bucket guarding the unauthenticated callable (same
 * pattern as TokenBucketRateLimiter in packages/backend/chat). App Check is
 * disabled for the client (PUBLIC_DISABLE_APP_CHECK=1), so rate limiting is
 * the defense against excessive Firestore-backed polls. Buckets are per
 * instance — not a global quota — but reject the common abuse shapes.
 */
const POLL_RATE_MAX_TOKENS = 30; // burst allowance
const POLL_RATE_REFILL_PER_SECOND = 2; // steady-state 2 req/s
let pollTokens = POLL_RATE_MAX_TOKENS;
let pollLastRefill = Date.now();

const tryConsumePollToken = (): boolean => {
  const now = Date.now();
  pollTokens = Math.min(
    POLL_RATE_MAX_TOKENS,
    pollTokens + ((now - pollLastRefill) / 1000) * POLL_RATE_REFILL_PER_SECOND,
  );
  pollLastRefill = now;
  if (pollTokens >= 1) {
    pollTokens -= 1;
    return true;
  }
  return false;
};

/**
 * Standalone callable — deliberately NOT routed through the `auth` callable's
 * `handleAuthEndpoint`, whose shared dispatcher requires an authenticated
 * caller for every action. This one must work for a caller with no session
 * (the Tauri desktop app, mid device-link handoff), so it stays outside that
 * multiplexed handler entirely rather than adding an exception to it.
 */
export default onCall<CallableFunctions, 'poll_device_handoff'>(async (request) => {
  const data = request.data;
  if (!data || typeof data.code !== 'string') {
    logger.warn('callable/poll_device_handoff: invalid request — missing code');
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Missing or invalid code field',
    });
  }

  // Rate-limit before touching Firestore — rejected requests never reach
  // the Firestore-backed pollDeviceHandoff call.
  if (!tryConsumePollToken()) {
    logger.warn('callable/poll_device_handoff: rate limited');
    throw toAppError({
      errorType: 'resource-exhausted',
      errorMessage: 'Too many polling requests — slow down and retry.',
    });
  }

  return await pollDeviceHandoff({ code: data.code });
});
