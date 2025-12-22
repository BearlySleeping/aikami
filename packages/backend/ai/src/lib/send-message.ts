import type { AIMessagePayload, AIMessageResponse, UserSessionData } from '@aikami/types'

import logger from '$logger'

export const sendMessage = (
  options: AIMessagePayload<'sendMessage'>,
  user: UserSessionData,
): AIMessageResponse<'sendMessage'> => {
  try {
    logger.log('sendMessage', options, user)

    // const text = await promptAI({
    // 	context,
    // });
    const text = ''

    return { text }
  } catch (error) {
    logger.error('sendMessage', error)
    throw error
  }
}
