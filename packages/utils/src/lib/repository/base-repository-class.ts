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
import type { z } from 'zod';
import { BaseClass } from '../common/base-class.ts';
import { toCoreData } from '../database/firestore-data-converters.ts';

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
   * @param documentSnap The DocumentSnapshot to convert.
   * @returns The data object.
   */
  toData(documentSnap: DocumentSnapshot): z.infer<T['data']>;

  /**
   * Retrieves a single document by its path arguments.
   * @param getDocumentPathArgument The arguments to build the document path.
   * @returns A promise that resolves to the document data, or undefined if not found.
   */
  getDocument(
    getDocumentPathArgument: T['getDocumentPathArgument'],
  ): Promise<z.infer<T['data']> | undefined>;

  /**
   * Retrieves all documents from a collection.
   * @param getCollectionPathArgument The arguments to build the collection path.
   * @param postSort An optional function to sort the documents after retrieval.
   * @returns A promise that resolves to an array of document data.
   */
  getDocumentsByCollection(
    getCollectionPathArgument: T['getCollectionPathArgument'],
    postSort?: PostSortDocuments<z.infer<T['data']>>,
  ): Promise<z.infer<T['data']>[]>;

  /**
   * Generates a new, unique document ID for a collection.
   * @param getCollectionPathArgument The arguments to build the collection path.
   * @returns A promise that resolves to a new document ID string.
   */
  getNewDocumentId(getCollectionPathArgument: T['getCollectionPathArgument']): Promise<string>;

  /**
   * Retrieves documents from a collection based on a query.
   * @param query The query options to filter, sort, and limit the documents.
   * @param postSort An optional function to sort the documents after retrieval.
   * @returns A promise that resolves to an array of document data.
   */
  getDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    postSort?: PostSortDocuments<z.infer<T['data']>>,
  ): Promise<z.infer<T['data']>[]>;

  /**
   * Adds a new document to a collection.
   * @param options The options containing the collection path arguments and the creation data.
   * @returns A promise that resolves to the new document's ID.
   */
  addDocument(options: {
    getCollectionPathArgument: T['getCollectionPathArgument'];
    createData: Omit<z.infer<T['createData']>, 'createdAt'>;
  }): Promise<string>;

  /**
   * Sets the data of a document, overwriting it if it exists.
   * @param options The options containing the document path arguments and the data to set.
   * @returns A promise that resolves when the operation is complete.
   */
  setDocument(options: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    setData: Omit<z.infer<T['createData']>, 'createdAt'>;
  }): Promise<void>;

  /**
   * Deletes a single document.
   * @param getDocumentPathArgument The arguments to build the document path.
   * @returns A promise that resolves when the operation is complete.
   */
  deleteDocument(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<void>;

  /**
   * Deletes multiple documents.
   * @param documentPaths An array of document path arguments.
   * @returns A promise that resolves when the operation is complete.
   */
  deleteDocuments(documentPaths: T['getDocumentPathArgument'][]): Promise<void>;

  /**
   * Gets a Firestore DocumentReference for a given document path.
   * @param getDocumentPathArgument The arguments to build the document path.
   * @returns A promise that resolves to a DocumentReference.
   */
  getDocumentReference<
    Document extends
      | z.infer<T['data']>
      | z.infer<T['createData']>
      | Partial<z.infer<T['updateData']>>,
  >(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<DocumentReference<Document>>;

  /**
   * Updates a document with new data.
   * @param options The options containing the document path arguments, the update data, and optional merge settings.
   * @returns A promise that resolves when the operation is complete.
   */
  updateDocument(options: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    updateData: Omit<Partial<z.infer<T['updateData']>>, 'updatedAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void>;

  /**
   * Gets a Firestore CollectionReference for a given collection path.
   * @param getCollectionPathArgument The arguments to build the collection path.
   * @returns A promise that resolves to a CollectionReference.
   */
  getCollectionReference<Document extends z.infer<T['data']> | z.infer<T['createData']>>(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<CollectionReference<Document>>;
};

export abstract class BaseRepository<T extends RepositoryType> extends BaseClass {
  protected readonly getCollectionPath: GetPathFunction<T['getCollectionPathArgument']>;
  protected readonly getDocumentPath: GetPathFunction<T['getDocumentPathArgument']>;
  private readonly _createSchema?: T['createData'];

  private readonly _updateSchema?: T['updateData'];

  private readonly _schema: T['data'];

  private readonly _parseLevel: ParseLevel;

  constructor(options: BaseRepositoryOptions<T>) {
    super({
      className: options.className,
    });
    this.getCollectionPath = options.getCollectionPath;
    this.getDocumentPath = options.getDocumentPath;
    if (options.createSchema) {
      this._createSchema = options.createSchema;
    }
    if (options.updateSchema) {
      this._updateSchema = options.updateSchema;
    }

    this._parseLevel = options.parseLevel ?? 'safe';

    this._schema = options.schema;
  }

  protected async parseDocuments(documents: DocumentSnapshot[]): Promise<z.infer<T['data']>[]> {
    if (this._parseLevel === 'off') {
      return documents.map((document) => this.toData(document));
    }

    const result: z.infer<T['data']>[] = [];
    for (const item of documents) {
      result.push(await this.parse('data', this.toData(item)));
    }
    return result;
  }

  // Overloads first
  protected async parse(
    type: 'createData',
    dataToParse: unknown,
  ): Promise<z.infer<T['createData']>>;
  protected async parse(
    type: 'updateData',
    dataToParse: unknown,
  ): Promise<z.infer<T['updateData']>>;
  protected async parse(type: 'data', dataToParse: unknown): Promise<z.infer<T['data']>>;

  // Implementation with a more lenient return type (Promise<any>)
  // The 'type' parameter is a union of literals, not generic for the implementation itself.
  protected async parse(
    type: 'data' | 'createData' | 'updateData',
    dataToParse: unknown,
    // deno-lint-ignore no-explicit-any
  ): Promise<any> {
    // Implementation's async nature wraps the returned value in Promise<any>
    // Inner helper function (remains the same)
    const doActualParse = async <SchemaType extends z.ZodTypeAny>(
      currentSchema: SchemaType | undefined,
      inputData: unknown,
    ): Promise<z.infer<SchemaType>> => {
      if (!currentSchema) {
        // Ensure a more specific error message if possible, or keep as is.
        throw new Error(`No schema available for type: ${type}`);
      }
      if (this._parseLevel === 'on') {
        return await currentSchema.parseAsync(inputData);
      }

      // _parseLevel === "safe"
      const parseResponse = await currentSchema.safeParseAsync(inputData);
      if (!parseResponse.success) {
        this.warn(`schema.safeParseAsync for type ${type}:`, parseResponse.error);
        // This cast matches the original behavior on safeParse failure.
        // Consider if a different error handling strategy is needed for "safe" failures.
        return inputData as z.infer<SchemaType>;
      }
      // If safeParseAsync is successful, parseResponse.data is already z.infer<SchemaType>
      return parseResponse.data;
    };

    if (this._parseLevel === 'off') {
      // Return type must align with the overloads based on the narrowed 'type'
      // In each case, 'type' (and thus K) is narrowed.
      // The value `dataToParse as z.infer<T[K]>` will be wrapped in a Promise by the async function.
      // This assertion tells TypeScript to trust that `dataToParse` is of the correct shape.
      switch (
        type // type is K
      ) {
        case 'createData':
          return dataToParse as z.infer<T['createData']>; // 'type' is "createData"
        case 'updateData':
          return dataToParse as z.infer<T['updateData']>; // 'type' is "updateData"
        case 'data':
          return dataToParse as z.infer<T['data']>; // 'type' is "data"
        default: {
          // This default case handles exhaustive checks for K.
          // If K is extended in the future and a case is missed, TypeScript will error here.
          const _exhaustiveCheck: never = type;
          throw new Error(`Unhandled parse type: ${_exhaustiveCheck}`);
        }
      }
    }

    switch (type) {
      case 'createData': {
        const result: z.infer<T['createData']> = await doActualParse(
          this._createSchema,
          dataToParse,
        );
        return result;
      }
      case 'updateData': {
        const result: z.infer<T['updateData']> = await doActualParse(
          this._updateSchema,
          dataToParse,
        );
        return result;
      }
      case 'data': {
        const result = await doActualParse(this._schema, dataToParse);
        return result as z.infer<T['data']>;
      }
      // Adding a default case for exhaustive check, though 'type' is constrained.
      // This can sometimes help TypeScript's control flow analysis or catch future errors if 'type' union changes.
      default: {
        // Already had braces, no change to content needed, just ensuring it's the target
        // This ensures that if 'type' union is ever expanded and a case is missed,
        // the compiler will error here.
        const _exhaustiveCheck: never = type;
        // It's good practice to throw an error in a default case that should be unreachable.
        throw new Error(`Unhandled parse type: ${_exhaustiveCheck}`);
      }
    }
  }

  toData(documentSnap: DocumentSnapshot): z.infer<T['data']> {
    return toCoreData(documentSnap);
  }
}
