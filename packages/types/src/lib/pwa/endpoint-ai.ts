import type { PersonaData } from '../database/persona.ts'

export type AIApiEvents = {
  createPersona: [
    {
      prompt: string
    },
    {
      persona: PersonaData
    },
  ]
  sendMessage: [
    {
      text: string
    },
    {
      text: string
    },
  ]
}

export type AIMessageData<T extends AIMessageType = AIMessageType> = {
  payload: AIMessagePayload<T>
  type: T
}

export type AIMessagePayload<T extends AIMessageType = AIMessageType> = AIApiEvents[T][0]

export type AIMessageResponse<T extends AIMessageType = AIMessageType> = AIApiEvents[T][1]

export type AIMessageType = keyof AIApiEvents
