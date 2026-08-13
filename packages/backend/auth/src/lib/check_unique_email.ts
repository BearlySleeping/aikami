import { getFirebaseAuthUserByEmail } from '@aikami/backend/utils/auth.ts';
import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types';

/**
 * Check if email exists
 *
 * The Firestore user document was deleted (C-386 OQ1). Email uniqueness is
 * enforced by Firebase Auth itself, so we check the Auth record directly.
 *
 * @param options the user email
 */
export const checkUniqueEmail = async (
  options: AuthMessagePayload<'checkUniqueEmail'>,
): Promise<AuthMessageResponse<'checkUniqueEmail'>> => {
  const { email } = options;
  try {
    await getFirebaseAuthUserByEmail(email);
    return false;
  } catch {
    return true;
  }
};
