// packages/backend/auth/src/lib/complete_device_handoff.ts

import { getFirestore } from '@aikami/backend/configs/database';
import { createCustomFirebaseToken } from '@aikami/backend/utils/auth.ts';
import type { AuthMessageResponse } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';

/**
 * Completes a device-flow authentication handoff for game clients.
 *
 * Creates a custom Firebase sign-in token for the authenticated user,
 * writes it to Firestore at `device_handoffs/{code}`, and returns
 * the token so the frontend can optionally use it directly.
 */
export const completeDeviceHandoff = async (options: {
  code: string;
  uid: string;
}): Promise<AuthMessageResponse<'completeDeviceHandoff'>> => {
  const { code, uid } = options;

  if (!code || !uid) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'code and uid are required for device handoff',
    });
  }

  logger.debug('completeDeviceHandoff', { code, uidLength: uid.length });

  const customFirebaseSignInToken = await createCustomFirebaseToken(uid);

  // Write the token to Firestore so the game client can poll and retrieve it
  await getFirestore().collection('device_handoffs').doc(code).set({
    code,
    customToken: customFirebaseSignInToken,
    uid,
    createdAt: new Date().toISOString(),
  });

  logger.info('completeDeviceHandoff:token-written', { code, uidLength: uid.length });

  return { customFirebaseSignInToken };
};
