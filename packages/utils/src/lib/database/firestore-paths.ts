// Users
export const getUsersCollectionPath = (): string => 'users';

export const getUserDocumentPath = (options: { uid: string }): string =>
  `${getUsersCollectionPath()}/${options.uid}`;

export const getUserFCMTokensCollectionPath = (options: { uid: string }): string =>
  `${getUserDocumentPath(options)}/tokens`;

export const getUserFCMTokenDocumentPath = (options: { fcmTokenId: string; uid: string }): string =>
  `${getUserFCMTokensCollectionPath(options)}/${options.fcmTokenId}`;

// Notifications
export const getNotificationsCollectionPath = (options: { uid: string }): string =>
  `${getUserDocumentPath(options)}/notifications`;

export const getNotificationDocumentPath = (options: {
  notificationId: string;
  uid: string;
}): string => `${getNotificationsCollectionPath(options)}/${options.notificationId}`;

// Stats
export const getTotalStatsDocumentPath = (): string => `stats/total`;

export const getUserStatsDocumentPath = (options: { uid: string }): string =>
  `${getTotalStatsDocumentPath()}/${getUserDocumentPath(options)}`;

// Personas
export const getPersonasCollectionPath = (): string => `personas`;

export const getPersonaDocumentPath = (options: { uid: string; personaId: string }): string =>
  `${getPersonasCollectionPath()}/${options.personaId}`;

// Chat
export const getChatsCollectionPath = (): string => 'chats';

export const getChatDocumentPath = (options: { chatId: string }): string =>
  `${getChatsCollectionPath()}/${options.chatId}`;

// Messages (subcollection of chat)
export const getMessagesCollectionPath = (options: { chatId: string }): string =>
  `${getChatDocumentPath(options)}/messages`;

export const getMessageDocumentPath = (options: { chatId: string; messageId: string }): string =>
  `${getMessagesCollectionPath(options)}/${options.messageId}`;

// Npcs
export const getNpcsCollectionPath = (): string => 'npcs';

export const getNpcDocumentPath = (options: { npcId: string }): string =>
  `${getNpcsCollectionPath()}/${options.npcId}`;

// Configs
export const getConfigsCollectionPath = (): string => 'configs';

export const getConfigDocumentPath = (options: { uid: string }): string =>
  `${getConfigsCollectionPath()}/${options.uid}`;
