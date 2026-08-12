// apps/backend/firebase/src/controllers/callable/poll_device_handoff.ts

import { pollDeviceHandoff } from '@aikami/backend/auth';
import type { CallableFunctions } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { onCall } from '@snorreks/firestack';
import { logger } from '$logger';

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

  return await pollDeviceHandoff({ code: data.code });
});
