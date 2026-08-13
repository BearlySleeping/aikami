import {
  createCustomFirebaseToken,
  createFirebaseAuthUser,
  deleteFirebaseAuthUser,
  updateUserClaims,
} from '@aikami/backend/utils/auth.ts';
import type {
  AuthCreateRequest,
  AuthMessagePayload,
  AuthMessageResponse,
  UserRole,
} from '@aikami/types';
import { toAppError, toUserClaims } from '@aikami/utils';

/**
 * Registers a new account.
 *
 * The Firestore user document was deleted (C-386 OQ1). Registration creates
 * the Firebase Auth account, sets the userRole custom claim, and returns a
 * custom sign-in token. displayName/email live on the Auth record itself.
 */
export const register = async (
  options: AuthMessagePayload<'register'>,
): Promise<AuthMessageResponse<'register'>> => {
  const { registerForm } = options;
  const createdHere = options.uid === undefined;
  let uid = options.uid;
  try {
    if (!uid) {
      const createRequest: AuthCreateRequest = {
        displayName: registerForm.displayName,
        email: registerForm.email,
        password: registerForm.password,
      };

      uid = await createFirebaseAuthUser(createRequest);
    }

    await updateUserClaims(
      toUserClaims({
        uid,
        token: { userRole: 'member' as UserRole },
      }),
    );

    const customFirebaseSignInToken = await createCustomFirebaseToken(uid);

    return {
      customFirebaseSignInToken,
      uid,
    };
  } catch (_error) {
    // Roll back the Auth account only if this call created it.
    if (createdHere && uid) {
      await deleteFirebaseAuthUser(uid);
    }
    throw toAppError({ errorType: 'internal', errorMessage: 'Registration failed' });
  }
};
