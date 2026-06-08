import {
  type UserRepositoryInterface,
  userRepository,
} from '@aikami/frontend/repositories/user.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { DocumentObservable, UserData, UserUpdateData } from '@aikami/types';

export type UserServiceOptions = BaseFrontendClassOptions & {
  database: UserRepositoryInterface;
};

export type UserServiceInterface = BaseFrontendClassInterface & {
  /**
   * Gets a user by ID.
   * @param uid The user ID.
   * @returns A promise that resolves with the user data, or undefined if not found.
   */
  getUser(uid: string): Promise<undefined | UserData>;

  /**
   * Gets an observable for a user by ID.
   * @param uid The user ID.
   * @returns A promise that resolves with a document observable.
   */
  getUserObservable(uid: string): Promise<DocumentObservable<UserData>>;

  /**
   * Updates a user's display name.
   * @param options The options.
   * @returns A promise that resolves with true if the update was successful, false otherwise.
   */
  updateDisplayName(options: { displayName: string; uid: string }): Promise<boolean>;

  /**
   * Updates a user's email address.
   * @param options The options.
   * @returns A promise that resolves with true if the update was successful, false otherwise.
   */
  updateEmail(options: { email: string; uid: string }): Promise<boolean>;

  /**
   * Updates a user.
   * @param uid The user ID.
   * @param userUpdateData The user data to update.
   * @returns A promise that resolves with true if the update was successful, false otherwise.
   */
  updateUser(uid: string, userUpdateData: Partial<UserUpdateData>): Promise<boolean>;
};

export class UserService
  extends BaseFrontendClass<UserServiceOptions>
  implements UserServiceInterface
{
  private get _database(): UserRepositoryInterface {
    return this._options.database;
  }

  async getUser(uid: string): Promise<undefined | UserData> {
    try {
      return await this._database.getDocument({ uid });
    } catch (error) {
      this.error('getUser', { error, uid });
      return;
    }
  }

  async getUserObservable(uid: string): Promise<DocumentObservable<UserData>> {
    this.log('getUserObservable', { uid });
    return await this._database.getDocumentStream({ uid });
  }

  async updateDisplayName(options: { displayName: string; uid: string }): Promise<boolean> {
    this.log('updateDisplayName', options);
    const { displayName, uid } = options;
    try {
      await this._database.updateDocument({
        getDocumentPathArgument: { uid },
        updateData: {
          displayName,
        },
      });
      return true;
    } catch (error) {
      this.error('updateUserDisplayName', error);
      return false;
    }
  }

  async updateEmail(options: { email: string; uid: string }): Promise<boolean> {
    this.log('updateEmail', options);
    const { email, uid } = options;
    try {
      await this._database.updateDocument({
        getDocumentPathArgument: { uid },
        updateData: {
          email,
        },
      });
      return true;
    } catch (error) {
      this.error('updateUserEmail', error);
      return false;
    }
  }

  async updateUser(uid: string, userUpdateData: Partial<UserUpdateData>): Promise<boolean> {
    try {
      await this._database.updateDocument({
        getDocumentPathArgument: { uid },
        updateData: userUpdateData,
      });
      return true;
    } catch (error) {
      this.error('updateUser', error);
      return false;
    }
  }
}

export const userService: UserServiceInterface = UserService.create({
  database: userRepository,
  className: 'UserService',
});
