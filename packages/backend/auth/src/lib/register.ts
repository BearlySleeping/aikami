import { deleteUserData, setUserData, toUserCreateData } from '@aikami/backend/database/user.ts';
import {
  createCustomFirebaseToken,
  createFirebaseAuthUser,
  deleteFirebaseAuthUser,
  updateUserClaims,
} from '@aikami/backend/utils/auth.ts';
import type { AuthCreateRequest, AuthMessagePayload, AuthMessageResponse } from '@aikami/types';

export const register = async (
  options: AuthMessagePayload<'register'>,
): Promise<AuthMessageResponse<'register'>> => {
  const { registerForm } = options;
  let uid = options.uid;
  let hasCreatedUserInFirestore = false;
  try {
    if (!uid) {
      const createRequest: AuthCreateRequest = {
        displayName: registerForm.displayName,
        email: registerForm.email,
        password: registerForm.password,
      };

      uid = await createFirebaseAuthUser(createRequest);
    }

    const userCreateData = toUserCreateData({
      userCreateForm: registerForm,
    });

    await Promise.all([
      updateUserClaims({
        ...userCreateData,
        id: uid,
      }),
      (async () => {
        await setUserData(uid, userCreateData);
        hasCreatedUserInFirestore = true;
      })(),
    ]);

    const customFirebaseSignInToken = await createCustomFirebaseToken(uid);

    return {
      customFirebaseSignInToken,
      uid,
    };
  } catch (error) {
    if (uid) {
      await Promise.all([
        deleteFirebaseAuthUser(uid),
        hasCreatedUserInFirestore && deleteUserData(uid),
      ]);
    }
    throw error;
  }
};
