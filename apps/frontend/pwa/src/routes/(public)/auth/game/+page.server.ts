// apps/frontend/pwa/src/routes/(public)/auth/game/+page.server.ts
import { getAuth } from '@aikami/backend/configs/auth';
import { type Actions, error } from '@sveltejs/kit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '$logger';

/**
 * Server-side actions for the Game Auth page.
 *
 * Handles the Device Flow auth handoff: after the user authenticates on the PWA,
 * a custom Firebase token is minted and written to Firestore for the game to pick up.
 */
export const actions: Actions = {
  /**
   * Completes the game auth handoff by minting a custom token
   * and writing it to Firestore at `auth_requests/{code}`.
   */
  completeHandoff: async ({ request }) => {
    logger.debug('completeHandoff action');

    const formData = await request.formData();
    const code = formData.get('code')?.toString();
    const uid = formData.get('uid')?.toString();

    if (!code || !uid) {
      logger.error('completeHandoff: missing code or uid');
      throw error(400, { message: 'Missing code or uid' });
    }

    // Validate code format: 6 alphanumeric chars
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      logger.error('completeHandoff: invalid code format');
      throw error(400, { message: 'Invalid code format' });
    }

    try {
      // Mint a custom Firebase token for the game client
      const customToken = await getAuth().createCustomToken(uid);

      // Write the token to Firestore for the game to pick up
      const firestore = getFirestore();
      await firestore.doc(`auth_requests/${code}`).update({
        status: 'completed',
        customToken,
        uid,
        completedAt: new Date().toISOString(),
      });

      logger.debug('completeHandoff: token written to Firestore', { code, uid });

      return { success: true };
    } catch (err) {
      logger.error('completeHandoff: failed', err);
      throw error(500, { message: 'Failed to complete auth handoff' });
    }
  },
};
