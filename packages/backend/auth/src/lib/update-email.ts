import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types'

import { updateUserData } from '@aikami/backend/database/user.ts'
import { updateFirebaseAuthUser } from '@aikami/backend/utils/auth.ts'
import { toAppError } from '@aikami/utils'

import { checkUniqueEmail } from './check-unique-email.ts'
import logger from '$logger'

export const updateEmail = async (
  options: AuthMessagePayload<'updateEmail'>,
): Promise<AuthMessageResponse<'updateEmail'>> => {
  try {
    logger.log('updateEmail', options)
    const { email, uid } = options
    if (!(await checkUniqueEmail({ email }))) {
      throw toAppError('invalid-argument', 'email already exists')
    }

    await Promise.all([
      updateFirebaseAuthUser(uid, { email }),
      updateUserData(uid, { email }),
    ])
  } catch (error) {
    logger.error('updateEmail', error)
    throw error
  }
}
