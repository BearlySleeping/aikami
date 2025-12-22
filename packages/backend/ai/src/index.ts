import type {
  AIApiEvents,
  AIMessagePayload,
  AIMessageResponse,
  AIMessageType,
  UserSessionData,
} from '@aikami/types'

import { createApiHandler } from '@aikami/utils'
import { createPersona } from './lib/persona-generation.ts'

import { sendMessage } from './lib/send-message.ts'

// Create an API handler for the given actions
const apiHandler = createApiHandler<AIApiEvents, UserSessionData>({
  createPersona,
  sendMessage,
})

export const handleAIEndpoint = async <T extends AIMessageType>(options: {
  currentUser: UserSessionData
  payload: AIMessagePayload<T>
  type: T
}): Promise<AIMessageResponse<T>> => {
  return await apiHandler(options, options.currentUser)
}
