// Users
export const getUsersCollectionPath = (): string => 'users'

export const getUserDocumentPath = (options: { uid: string }): string =>
  `${getUsersCollectionPath()}/${options.uid}`

export const getUserFCMTokensCollectionPath = (options: {
  uid: string
}): string => `${getUserDocumentPath(options)}/tokens`

export const getUserFCMTokenDocumentPath = (options: {
  fcmTokenId: string
  uid: string
}): string => `${getUserFCMTokensCollectionPath(options)}/${options.fcmTokenId}`

// Notifications
export const getNotificationsCollectionPath = (options: {
  uid: string
}): string => `${getUserDocumentPath(options)}/notifications`

export const getNotificationDocumentPath = (options: {
  notificationId: string
  uid: string
}): string => `${getNotificationsCollectionPath(options)}/${options.notificationId}`

// Stats
export const getTotalStatsDocumentPath = (): string => `stats/total`

export const getUserStatsDocumentPath = (options: { uid: string }): string =>
  `${getTotalStatsDocumentPath()}/${getUserDocumentPath(options)}`

// Personas
export const getPersonasCollectionPath = (options: { uid: string }): string =>
  `${getUserDocumentPath(options)}/personas`

export const getPersonaDocumentPath = (options: {
  uid: string
  personaId: string
}): string => `${getPersonasCollectionPath(options)}/${options.personaId}`

// Chat
export const getMessagesCollectionPath = (options: {
  uid: string
}): string => `${getUserDocumentPath(options)}/chats`

export const getMessageDocumentPath = (options: {
  uid: string
  chatId: string
}): string => `${getMessagesCollectionPath(options)}/${options.chatId}`

// Npcs
export const getNpcsCollectionPath = (): string => 'npcs'

export const getNpcDocumentPath = (options: {
  npcId: string
}): string => `${getNpcsCollectionPath()}/${options.npcId}`
