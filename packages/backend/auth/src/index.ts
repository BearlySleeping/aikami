import type {
  AuthApiEvents,
  AuthMessagePayload,
  AuthMessageResponse,
  AuthMessageType,
  UserClaims,
} from '@aikami/types';

import { createApiHandler, toAppError } from '@aikami/utils';

import { checkUniqueEmail } from './lib/check_unique_email.ts';
import { confirmTermsAndService } from './lib/confirm_terms_and_service.ts';
import { createCustomFirebaseSignInToken } from './lib/create_custom_firebase_token.ts';
import { deleteAccount } from './lib/delete_account.ts';
import { register } from './lib/register.ts';
import { sendResetPassword } from './lib/send_reset_password.ts';
import { updateEmail } from './lib/update_email.ts';

const apiHandler = createApiHandler<AuthApiEvents, UserClaims | undefined>({
  checkUniqueEmail,
  confirmTermsAndService,
  createCustomFirebaseSignInToken: (_payload, user) => {
    if (!user) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'User not logged in',
      });
    }
    return createCustomFirebaseSignInToken({
      uid: user.id,
    });
  },
  deleteAccount: (_payload, user) => {
    if (!user) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'User not logged in',
      });
    }
    return deleteAccount(user.id);
  },

  register,
  sendResetPassword,
  updateEmail: (payload, user) => {
    if (!user) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'User not logged in',
      });
    }
    return updateEmail({
      ...payload,
      uid: user.id,
    });
  },
});

export const handleAuthEndpoint = async <T extends AuthMessageType>(options: {
  currentUser?: UserClaims;
  payload: AuthMessagePayload<T>;
  type: T;
}): Promise<AuthMessageResponse<T>> => {
  const { currentUser } = options;

  return await apiHandler(options, currentUser);
};
