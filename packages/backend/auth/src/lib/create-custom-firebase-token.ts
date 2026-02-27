import { createCustomFirebaseToken } from '@aikami/backend/utils/auth.ts';
import type { AuthMessageResponse } from '@aikami/types';

export const createCustomFirebaseSignInToken = async (options: {
  uid: string;
}): Promise<AuthMessageResponse<'createCustomFirebaseSignInToken'>> => {
  const { uid } = options;

  const customFirebaseSignInToken = await createCustomFirebaseToken(uid);
  return { customFirebaseSignInToken };
};
