// packages/shared/utils/src/lib/repository/base_repository_class.ts

import { validateWithLevel } from '@aikami/schemas';
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  GetPathFunction,
  GetQueryOptions,
  ParseLevel,
  PostSortDocuments,
  RepositoryType,
} from '@aikami/types';
import type Type from 'typebox';
import type { TSchema } from 'typebox';
import { BaseClass } from '../common/base_class.ts';
import { toCoreData } from '../database/firestore_data_converters.ts';

export type BaseRepositoryOptions<T extends RepositoryType> = {
  className: string;
  getCollectionPath: GetPathFunction<T['getCollectionPathArgument']>;
  getDocumentPath: GetPathFunction<T['getDocumentPathArgument']>;
  createSchema: T['createData'] extends never ? undefined : T['createData'];
  updateSchema: T['updateData'] extends never ? undefined : T['updateData'];
  schema: T['data'];
  parseLevel?: ParseLevel;
};

export type BaseRepositoryInterface<T extends RepositoryType> = {
  /**
   * Converts a Firestore DocumentSnapshot to a plain data object.
   */
  toData(documentSnap: DocumentSnapshot): Type.Static<T['data']>;

  /**
   * Retrieves a single document by its path arguments.
   */
  getDocument(
    getDocumentPathArgument: T['getDocumentPathArgument'],
  ): Promise<Type.Static<T['data']> | undefined>;

  /**
   * Retrieves all documents from a collection.
   */
  getDocumentsByCollection(
    getCollectionPathArgument: T['getCollectionPathArgument'],
    postSort?: PostSortDocuments<Type.Static<T['data']>>,
  ): Promise<Type.Static<T['data']>[]>;

  /**
   * Generates a new, unique document ID for a collection.
   */
  getNewDocumentId(getCollectionPathArgument: T['getCollectionPathArgument']): Promise<string>;

  /**
   * Retrieves documents from a collection based on a query.
   */
  getDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    postSort?: PostSortDocuments<Type.Static<T['data']>>,
  ): Promise<Type.Static<T['data']>[]>;

  /**
   * Adds a new document to a collection.
   */
  addDocument(options: {
    getCollectionPathArgument: T['getCollectionPathArgument'];
    createData: Omit<Type.Static<T['createData']>, 'createdAt'>;
  }): Promise<string>;

  /**
   * Sets the data of a document, overwriting it if it exists.
   */
  setDocument(options: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    setData: Omit<Type.Static<T['createData']>, 'createdAt'>;
  }): Promise<void>;

  /**
   * Deletes a single document.
   */
  deleteDocument(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<void>;

  /**
   * Deletes multiple documents.
   */
  deleteDocuments(documentPaths: T['getDocumentPathArgument'][]): Promise<void>;

  /**
   * Gets a Firestore DocumentReference for a given document path.
   */
  getDocumentReference<
    Document extends
      | Type.Static<T['data']>
      | Type.Static<T['createData']>
      | Partial<Type.Static<T['updateData']>>,
  >(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<DocumentReference<Document>>;

  /**
   * Updates a document with new data.
   */
  updateDocument(options: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    updateData: Omit<Partial<Type.Static<T['updateData']>>, 'updatedAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void>;

  /**
   * Gets a Firestore CollectionReference for a given collection path.
   */
  getCollectionReference<Document extends Type.Static<T['data']> | Type.Static<T['createData']>>(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<CollectionReference<Document>>;
};

export abstract class BaseRepository<T extends RepositoryType> extends BaseClass {
  protected readonly getCollectionPath: GetPathFunction<T['getCollectionPathArgument']>;
  protected readonly getDocumentPath: GetPathFunction<T['getDocumentPathArgument']>;
  private readonly _parseLevel: ParseLevel;
  private readonly _schema: TSchema;
  private readonly _createSchema: TSchema | undefined;
  private readonly _updateSchema: TSchema | undefined;

  constructor(options: BaseRepositoryOptions<T>) {
    super({
      className: options.className,
    });
    this.getCollectionPath = options.getCollectionPath;
    this.getDocumentPath = options.getDocumentPath;
    this._parseLevel = options.parseLevel ?? 'safe';
    this._schema = options.schema as TSchema;
    this._createSchema = options.createSchema as TSchema | undefined;
    this._updateSchema = options.updateSchema as TSchema | undefined;
  }

  protected async parseDocuments(documents: DocumentSnapshot[]): Promise<Type.Static<T['data']>[]> {
    if (this._parseLevel === 'off') {
      return documents.map((document) => this.toData(document));
    }

    const result: Type.Static<T['data']>[] = [];
    for (const item of documents) {
      result.push(await this.parse('data', this.toData(item)));
    }
    return result;
  }

  // Overloads first
  protected async parse(
    type: 'createData',
    dataToParse: unknown,
  ): Promise<Type.Static<T['createData']>>;
  protected async parse(
    type: 'updateData',
    dataToParse: unknown,
  ): Promise<Type.Static<T['updateData']>>;
  protected async parse(type: 'data', dataToParse: unknown): Promise<Type.Static<T['data']>>;

  // Implementation
  protected async parse(
    type: 'data' | 'createData' | 'updateData',
    dataToParse: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: Generic parse method returns inferred type
  ): Promise<any> {
    const schema = this._getSchemaForType(type);
    if (!schema) {
      // Schema not provided for this operation type — pass through.
      return dataToParse;
    }

    const valid = validateWithLevel({
      schema,
      value: dataToParse,
      parseLevel: this._parseLevel,
      context: `${this._className}.parse(${type})`,
    });

    // valid is true in 'off' and 'on' (on throws on failure).
    // In 'safe' mode, valid may be false but we still return original data.
    if (!valid) {
      this.warn(`parse(${type}): validation failed, returning original data`);
    }

    return dataToParse;
  }

  /** Map parse type string to the corresponding TypeBox schema. */
  private _getSchemaForType(type: 'data' | 'createData' | 'updateData'): TSchema | undefined {
    switch (type) {
      case 'data':
        return this._schema;
      case 'createData':
        return this._createSchema;
      case 'updateData':
        return this._updateSchema;
      default: {
        const _exhaustiveCheck: never = type;
        throw new Error(`Unhandled parse type: ${_exhaustiveCheck}`);
      }
    }
  }

  toData(documentSnap: DocumentSnapshot): Type.Static<T['data']> {
    return toCoreData(documentSnap);
  }
}
