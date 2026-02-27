import { updateUserData } from '@aikami/backend/database/user.ts';
import { updateFirebaseAuthUser } from '@aikami/backend/utils/auth.ts';
import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import logger from '$logger';
import { checkUniqueEmail } from './check-unique-email.ts';

export const updateEmail = async (
  options: AuthMessagePayload<'updateEmail'>,
): Promise<AuthMessageResponse<'updateEmail'>> => {
  try {
    logger.log('updateEmail', options);
    const { email, uid } = options;
    if (!(await checkUniqueEmail({ email }))) {
      throw toAppError('invalid-argument', 'email already exists');
    }

    await Promise.all([updateFirebaseAuthUser(uid, { email }), updateUserData(uid, { email })]);
  } catch (error) {
    logger.error('updateEmail', error);
    throw error;
  }
};
