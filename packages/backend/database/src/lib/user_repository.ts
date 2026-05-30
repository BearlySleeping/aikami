// packages/backend/database/src/lib/user-repository.ts
import type { BaseDatabaseService, QueryOptions } from './base-database-service';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** User document shape for the repository example. */
export type UserDocument = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
  firstName?: string;
  lastName?: string;
};

/** Input shape when creating a user. */
export type CreateUserInput = Omit<UserDocument, 'id' | 'createdAt' | 'updatedAt'>;

/** Input shape when updating a user. */
export type UpdateUserInput = Partial<Omit<UserDocument, 'id' | 'createdAt'>>;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Example repository demonstrating the {@link BaseDatabaseService} abstraction.
 *
 * All database operations are routed through the injected service, making the
 * repository trivially testable with any implementation (mock, Data Connect,
 * or future engines).
 *
 * **Coding rules:**  Guard clauses, arrow functions, `{}` on every `if`.
 */
export class UserRepository {
  private readonly collection = 'users';

  constructor(private readonly db: BaseDatabaseService) {
    if (!db) {
      throw new Error('UserRepository requires a BaseDatabaseService instance.');
    }

    this.db = db;
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /** Fetch a user by id.  Returns `undefined` when not found. */
  findById = async (id: string): Promise<UserDocument | undefined> => {
    if (!id) {
      throw new Error('id is required.');
    }

    return this.db.getDocument<UserDocument>(this.collection, id);
  };

  /** List all users (with optional filters). */
  findAll = async (options?: QueryOptions): Promise<UserDocument[]> => {
    return this.db.getDocuments<UserDocument>(this.collection, options);
  };

  /** Create a new user.  Returns the generated id. */
  create = async (input: CreateUserInput): Promise<string> => {
    if (!input) {
      throw new Error('input is required.');
    }

    if (!input.email) {
      throw new Error('email is required.');
    }

    const now = new Date().toISOString();

    return this.db.addDocument<UserDocument>(this.collection, {
      id: '', // placeholder — engine assigns
      displayName: input.displayName,
      email: input.email,
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
      createdAt: now,
      updatedAt: now,
    } as UserDocument);
  };

  /** Overwrite a user at a specific id. */
  set = async (id: string, input: CreateUserInput): Promise<void> => {
    if (!id) {
      throw new Error('id is required.');
    }

    if (!input) {
      throw new Error('input is required.');
    }

    const now = new Date().toISOString();

    await this.db.setDocument<UserDocument>(this.collection, id, {
      id,
      displayName: input.displayName,
      email: input.email,
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
      createdAt: now,
      updatedAt: now,
    } as UserDocument);
  };

  /** Merge partial data into an existing user. */
  update = async (id: string, input: UpdateUserInput): Promise<void> => {
    if (!id) {
      throw new Error('id is required.');
    }

    if (!input) {
      throw new Error('input is required.');
    }

    await this.db.updateDocument<UserDocument>(this.collection, id, {
      ...input,
      updatedAt: new Date().toISOString(),
    } as Partial<UserDocument>);
  };

  /** Remove a user. */
  remove = async (id: string): Promise<void> => {
    if (!id) {
      throw new Error('id is required.');
    }

    await this.db.deleteDocument(this.collection, id);
  };

  /** Find users by role using a filter query. */
  findByRole = async (role: string): Promise<UserDocument[]> => {
    if (!role) {
      throw new Error('role is required.');
    }

    return this.db.getDocuments<UserDocument>(this.collection, {
      filters: [{ field: 'role', operator: '==', value: role }],
    });
  };
}
