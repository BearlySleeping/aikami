import { updateUserClaims } from '@aikami/backend/utils/auth.ts';
import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types';
import { logger } from '$logger';

export const confirmTermsAndService = async (
  options: AuthMessagePayload<'confirmTermsAndService'>,
): Promise<AuthMessageResponse<'confirmTermsAndService'>> => {
  try {
    logger.log('confirmTermsAndService', options);
    const { uid } = options;

    // The Firestore user document was deleted (C-386 OQ1). Terms acceptance
    // is recorded as a status claim on the Auth account itself.
    await updateUserClaims({
      id: uid,
      status: 'active',
    });
    return undefined;
  } catch (error) {
    logger.error('confirmTermsAndService', error);
    throw error;
  }
};
