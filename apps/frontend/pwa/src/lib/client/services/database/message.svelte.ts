import type { DocumentsObservable, MessageCreateData, MessageData } from '@aikami/types'
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services'
import {
  messageRepository,
  type MessageRepositoryInterface,
} from '@aikami/frontend/repositories/message.ts'

export type MessageServiceOptions = BaseFrontendClassOptions & {
  database: MessageRepositoryInterface
}

export type MessageServiceInterface = BaseFrontendClassInterface & {
  /**
   * Gets all messages for a character.
   * @param uid The user ID.
   * @param characterId The character ID.
   * @returns A promise that resolves with an array of message data.
   */
  getMessages(
    uid: string,
    characterId: string,
  ): Promise<MessageData[]>

  /**
   * Gets an observable for all messages for a character.
   * @param uid The user ID.
   * @param characterId The character ID.
   * @returns A promise that resolves with a documents observable.
   */
  getMessagesObservable(
    uid: string,
    characterId: string,
  ): Promise<DocumentsObservable<MessageData>>

  /**
   * Creates a new message.
   * @param uid The user ID.
   * @param characterId The character ID.
   * @param messageData The message data to create.
   * @returns A promise that resolves with the new message ID.
   */
  createMessage(
    uid: string,
    characterId: string,
    messageData: MessageCreateData,
  ): Promise<string | undefined>
}

export class MessageService extends BaseFrontendClass<MessageServiceOptions>
  implements MessageServiceInterface {
  private get _database(): MessageRepositoryInterface {
    return this._options.database
  }

  async getMessages(
    uid: string,
    characterId: string,
  ): Promise<MessageData[]> {
    this.log('getMessages', { uid, characterId })
    try {
      return await this._database.getDocumentsByCollection({ uid })
    } catch (error) {
      this.error('getMessages', { error, uid, characterId })
      return []
    }
  }

  async getMessagesObservable(
    uid: string,
    characterId: string,
  ): Promise<DocumentsObservable<MessageData>> {
    this.log('getMessagesObservable', { uid, characterId })
    return await this._database.getDocumentsStreamByQuery({
      getCollectionPathArgument: { uid },
      orderBy: { field: 'createdAt', order: 'asc' },
    })
  }

  async createMessage(
    uid: string,
    characterId: string,
    messageData: MessageCreateData,
  ): Promise<string | undefined> {
    this.log('createMessage', { uid, characterId, messageData })
    try {
      const docId = await this._database.addDocument({
        getCollectionPathArgument: { uid },
        createData: messageData,
      })
      return docId
    } catch (error) {
      this.error('createMessage', { error, uid, characterId })
      return
    }
  }
}

export const messageService: MessageServiceInterface = new MessageService({
  database: messageRepository,
  className: 'MessageService',
})
