import { getAppCheck } from '@aikami/backend/configs/app-check.ts'
import { toAppError } from '@aikami/utils'
import logger from '$logger'

export const verifyAppCheck = async (request: { headers: Headers }) => {
  try {
    const appCheckToken = request.headers.get('X-Firebase-AppCheck')
    // logger.log('verifyAppCheck:appCheckToken', appCheckToken);
    if (!appCheckToken) {
      throw toAppError('captcha-required', 'Missing app check token')
    }

    await getAppCheck().verifyToken(appCheckToken)
    logger.log('verifyAppCheck:valid')
  } catch (error) {
    logger.error('verifyAppCheck:error', error)
    throw toAppError('internal', 'Failed to verify app check token', error)
  }
}
