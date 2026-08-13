import { getFirebaseAuthUserByEmail, getPasswordResetLink } from '@aikami/backend/utils/auth.ts';
import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types';
import { toAppError, toSupportedLocale } from '@aikami/utils';
import { logger } from '$logger';

/**
 * Send reset password if email exists
 *
 * The Firestore user document was deleted (C-386 OQ1). Email lookup now uses
 * the Firebase Auth record; the preferred locale comes from custom claims.
 */
export const sendResetPassword = async (
  options: AuthMessagePayload<'sendResetPassword'>,
): Promise<AuthMessageResponse<'sendResetPassword'>> => {
  const { email } = options;
  let user: Awaited<ReturnType<typeof getFirebaseAuthUserByEmail>>;
  try {
    user = await getFirebaseAuthUserByEmail(email);
  } catch {
    throw toAppError({
      errorType: 'not-found',
      errorMessage: `User with email ${email} not found`,
    });
  }

  const supportedLocale = toSupportedLocale(user.preferredLocale);

  const passwordResetLink = await getPasswordResetLink({
    email,
    isFirstTime: false,
    supportedLocale,
  });

  logger.log('info', 'Password reset email sent', { email, passwordResetLink });
  throw new Error('Implement postmark');
};
