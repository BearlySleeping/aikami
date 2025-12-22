import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types'

import { getUserByEmail } from '@aikami/backend/database/user.ts'
import { getPasswordResetLink } from '@aikami/backend/utils/auth.ts'
import { toSupportedLocale } from '@aikami/utils'
import { toAppError } from '@aikami/utils'
import logger from '$logger'

/**
 * Send reset password if email exists
 *
 * @param options the user email
 */
export const sendResetPassword = async (
  options: AuthMessagePayload<'sendResetPassword'>,
): Promise<AuthMessageResponse<'sendResetPassword'>> => {
  const { email } = options
  const user = await getUserByEmail(email)
  if (!user) {
    throw toAppError('not-found', `User with email ${email} not found`)
  }

  const isFirstTime = !user.agreedAt
  const supportedLocale = toSupportedLocale(user.localeCode)

  const passwordResetLink = await getPasswordResetLink({
    email,
    isFirstTime,
    supportedLocale,
  })

  logger.log('info', 'Password reset email sent', { email, passwordResetLink })
  throw new Error('Implement postmark')
}
