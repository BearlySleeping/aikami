import type { AuthMessagePayload, AuthMessageResponse, UserClaims } from '@aikami/types'

import { updateUserClaimsOptional, updateUserData } from '@aikami/backend/database/user.ts'
import logger from '$logger'

export const confirmTermsAndService = async (
  options: AuthMessagePayload<'confirmTermsAndService'>,
): Promise<AuthMessageResponse<'confirmTermsAndService'>> => {
  try {
    logger.log('confirmTermsAndService', options)
    const { uid } = options
    const userUpdateData: Partial<UserClaims> = {
      status: 'active',
    }

    await Promise.all([
      updateUserClaimsOptional(uid, userUpdateData),
      updateUserData(uid, userUpdateData),
    ])
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  } catch (error) {
    logger.error('confirmTermsAndService', error)
    throw error
  }
}
