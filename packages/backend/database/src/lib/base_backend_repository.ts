import { getFirestore } from '@aikami/backend/configs/database';
import { getEnvironmentValue } from '@aikami/backend/configs/environment';
import { documentId, serverTimestamp } from '@aikami/backend/configs/firestore';
import { getBatch } from '@aikami/backend/utils/batch';
import type { GetQueryOptions, ParseLevel, QueryFilter, RepositoryType } from '@aikami/types';
import {
  BaseRepository,
  type BaseRepositoryInterface,
  type BaseRepositoryOptions,
} from '@aikami/utils';
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  PartialWithFieldValue,
  Query,
} from '@google-cloud/firestore';
import type { z } from 'zod';

export type BackendRepositoryInterface<T extends RepositoryType> = BaseRepositoryInterface<T> & {
  /**
   * Deletes an array of documents based on a query.
   * @param query The query to find documents to delete.
   * @param shouldDelete An optional function to conditionally delete a document. Return true to delete.
   */
  deleteDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    shouldDelete?: (document: z.infer<T['data']>) => Promise<boolean> | boolean,
  ): Promise<void>;

  /**
   * Updates an array of documents based on a query.
   * @param query The query to find documents to update.
   * @param update A function that returns the partial data to update. Return undefined to skip the update.
   * @param options Optional merge options.
   */
  updateDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    update: (
      document: z.infer<T['data']>,
    ) =>
      | Promise<Partial<z.infer<T['updateData']>> | undefined>
      | Partial<z.infer<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ): Promise<void>;

  /**
   * Updates a given array of document snapshots.
   * @param documents The document snapshots to update.
   * @param update A function that returns the partial data to update. Return undefined to skip the update.
   * @param options Optional merge options.
   */
  updateDocuments(
    documents: DocumentSnapshot[],
    update: (
      document: z.infer<T['data']>,
    ) =>
      | Promise<Partial<z.infer<T['updateData']>> | undefined>
      | Partial<z.infer<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ): Promise<void>;

  /**
   * Retrieves documents based on a list of IDs.
   * @param getCollectionPathArgument Argument for the collection path function.
   * @param ids An array of document IDs to retrieve.
   * @returns A promise that resolves to an array of document snapshots.
   */
  getDocumentsBaseOnIds(
    getCollectionPathArgument: T['getCollectionPathArgument'],
    ids: string[],
  ): Promise<DocumentSnapshot[]>;

  /**
   * A utility function to construct a query filter array.
   * @param filters The filters to apply.
   * @returns An array of query filters.
   */
  getFilters(...filters: QueryFilter<z.infer<T['data']>>[]): QueryFilter<z.infer<T['data']>>[];
};

export class BackendRepository<T extends RepositoryType>
  extends BaseRepository<T>
  implements BackendRepositoryInterface<T>
{
  private static _database?: Firestore;

  constructor(options: BaseRepositoryOptions<T>) {
    super({
      ...options,
      parseLevel:
        options.parseLevel ?? (getEnvironmentValue('PARSE_LEVEL', true) as ParseLevel | undefined),
    });
  }

  async getDocument(
    getDocumentPathArguments: T['getDocumentPathArgument'],
  ): Promise<z.infer<T['data']> | undefined> {
    const documentReference =
      await this.getDocumentReference<z.infer<T['data']>>(getDocumentPathArguments);
    const documentSnap = await documentReference.get();
    if (!documentSnap.exists) {
      return;
    }

    const data = this.toData(documentSnap);
    return this.parse('data', data);
  }

  async getDocumentsByCollection(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<z.infer<T['data']>[]> {
    const collectionReference =
      await this.getCollectionReference<z.infer<T['data']>>(getCollectionPathArgument);

    const querySnapshot = await collectionReference.get();
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs.filter((doc) => doc.exists));
  }

  async getNewDocumentId(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<string> {
    const newDocumentId = (await this.getCollectionReference(getCollectionPathArgument)).doc().id;
    return newDocumentId;
  }

  async getDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<z.infer<T['data']>[]> {
    const queryReference = await this._getQuery(query);
    const querySnapshot = await queryReference.get();
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs.filter((doc) => doc.exists));
  }

  async addDocument({
    createData,
    getCollectionPathArgument,
  }: {
    getCollectionPathArgument: T['getCollectionPathArgument'];
    createData: Omit<z.infer<T['createData']>, 'createdAt'>;
	  }): Promise<string> {
    this.debug('addDocument', createData);
    
    const collectionReference =
      await this.getCollectionReference<z.infer<T['createData']>>(getCollectionPathArgument);


    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...createData,
    });
    const response = await collectionReference.add(data);

    return response.id;
  }

  async setDocument({
    getDocumentPathArgument,
    options,
    setData,
  }: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    setData: Omit<z.infer<T['createData']>, 'createdAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void> {
    const documentReference = await this.getDocumentReference(getDocumentPathArgument);
    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...setData,
    });

    await documentReference.set(data, {
      merge: options?.merge,
    });
  }

  async deleteDocument(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<void> {
    const documentReference = await this.getDocumentReference(getDocumentPathArgument);

    await documentReference.delete();
  }

  async deleteDocuments(getDocumentPathArguments: T['getDocumentPathArgument'][]): Promise<void> {
    const database = await this._getDatabase();
    const batch = database.batch();

    const documentReferences = await Promise.all(
      getDocumentPathArguments.map((getDocumentPathArgument) =>
        this.getDocumentReference(getDocumentPathArgument),
      ),
    );

    for (const documentReference of documentReferences) {
      batch.delete(documentReference);
    }

    await batch.commit();
  }

  async deleteDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    shouldDelete?: (document: z.infer<T['data']>) => Promise<boolean> | boolean,
  ): Promise<void> {
    const queryReference = await this._getQuery(query);
    const querySnapshot = await queryReference.get();
    if (querySnapshot.empty) {
      return;
    }

    const documents = querySnapshot.docs.filter((doc) => doc.exists);
    const database = await this._getDatabase();

    const batchArray = [database.batch()];
    let operationCounter = 0;
    let batchIndex = 0;

    const handleQuery = async (document: DocumentSnapshot) => {
      if (shouldDelete && !(await shouldDelete(this.toData(document)))) {
        return;
      }
      batchArray[batchIndex]?.delete(document.ref);
      operationCounter++;

      if (operationCounter > 498) {
        batchArray.push(database.batch());
        batchIndex++;
        operationCounter = 0;
      }
    };

    const baseBatch = getBatch();

    for (const document of documents) {
      baseBatch.push(() => handleQuery(document));
    }

    await baseBatch.commit();
    await Promise.all(batchArray.map((batch) => batch.commit()));
  }

  async getDocumentReference<
    Document extends
      | z.infer<T['data']>
      | z.infer<T['createData']>
      | Partial<z.infer<T['updateData']>>,
  >(documentArgument: T['getDocumentPathArgument']): Promise<DocumentReference<Document>> {
    const database = await this._getDatabase();

    return database.doc(this.getDocumentPath(documentArgument)) as DocumentReference<Document>;
  }

  async updateDocument({
    getDocumentPathArgument,
    options,
    updateData,
  }: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    // updateData: FirestoreUpdateData<Partial<z.infer<T['updateData']>>>;
    updateData: Omit<Partial<z.infer<T['updateData']>>, 'updatedAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void> {
    // Change the type argument for getDocumentReference to the main document model
    const documentReference =
      await this.getDocumentReference<
        z.infer<T['data']> // Changed from Partial<z.infer<T["updateData"]>>
      >(getDocumentPathArgument);

    const data = await this.parse('updateData', {
      updatedAt: serverTimestamp(),
      ...updateData,
    });

    if (options?.merge) {
      // For set with merge, data (z.infer<T["updateData"]>) should be assignable
      // to Partial<z.infer<T["data"]>> which is expected by documentReference.set()
      // Cast 'data' to what .set with merge expects: PartialWithFieldValue<FullModel>
      // This assumes that z.infer<T["updateData"]> is structurally compatible
      // as a partial update for z.infer<T["data"]>.
      await documentReference.set(data as PartialWithFieldValue<z.infer<T['data']>>, {
        merge: true,
      });
    } else {
      // For update, data (z.infer<T["updateData"]>) should be assignable
      // to UpdateData<z.infer<T["data"]>> which is expected by documentReference.update()
      await documentReference.update(data); // Removed the problematic cast
    }
  }

  async getCollectionReference<Document extends z.infer<T['data']> | z.infer<T['createData']>>(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<CollectionReference<Document>> {
    const database = await this._getDatabase();

    return database.collection(
      this.getCollectionPath(getCollectionPathArgument),
    ) as CollectionReference<Document>;
  }
  async updateDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    update: (
      document: z.infer<T['data']>,
    ) =>
      | Promise<Partial<z.infer<T['updateData']>> | undefined>
      | Partial<z.infer<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ): Promise<void> {
    const queryReference = await this._getQuery(query);
    const querySnapshot = await queryReference.get();
    if (querySnapshot.empty) {
      return;
    }
    await this.updateDocuments(
      querySnapshot.docs.filter((doc) => doc.exists),
      update,
      options,
    );
  }

  async updateDocuments(
    documents: DocumentSnapshot[],
    update: (
      document: z.infer<T['data']>,
    ) =>
      | Promise<Partial<z.infer<T['updateData']>> | undefined>
      | Partial<z.infer<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ) {
    const database = await this._getDatabase();

    const batchArray = [database.batch()];
    let operationCounter = 0;
    let batchIndex = 0;

    const handleDocument = async (document: DocumentSnapshot) => {
      const updateData = await update(this.toData(document));
      if (!updateData) {
        return;
      }

      const batch = batchArray[batchIndex];
      if (!batch) {
        throw new Error(`Batch is undefined at index ${batchIndex}`);
      }

      if (options?.merge) {
        batch.set(document.ref, updateData as Partial<unknown>, {
          merge: true,
        });
      } else {
        batch.update(document.ref, updateData as Partial<unknown>);
      }

      operationCounter++;

      if (operationCounter > 498) {
        batchArray.push(database.batch());
        batchIndex++;
        operationCounter = 0;
      }
    };

    const baseBatch = getBatch();

    for (const document of documents) {
      baseBatch.push(() => handleDocument(document));
    }

    await baseBatch.commit();

    await Promise.all(batchArray.map((batch) => batch.commit()));
  }

  async getDocumentsBaseOnIds(
    getCollectionPathArgument: T['getCollectionPathArgument'],
    ids: string[],
  ): Promise<DocumentSnapshot[]> {
    const collectionReference = await this.getCollectionReference(getCollectionPathArgument);
    if (ids.length <= 10) {
      const snapshot = await collectionReference.where(documentId(), 'in', ids).get();
      return snapshot.docs.filter((doc) => doc.exists);
    }

    const allDocs: DocumentSnapshot[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const end = i + 10;
      const chunk = ids.slice(i, end);
      const snapshot = await collectionReference.where(documentId(), 'in', chunk).get();
      allDocs.push(...snapshot.docs.filter((doc) => doc.exists));
    }
    return allDocs;
  }

  getFilters(...filters: QueryFilter<z.infer<T['data']>>[]): QueryFilter<z.infer<T['data']>>[] {
    return filters;
  }

  /**
   * NB: You cannot order your query by any field included in an equality (=)
   * or in clause.
   * https://firebase.google.com/docs/firestore/query-data/order-limit-data#limitations
   *
   * @param options - Options
   * @returns Query
   */
  private async _getQuery(
    options: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Query<z.infer<T['data']>>> {
    const {
      collectionGroupName,
      filters,
      getCollectionPathArgument,
      limit: limitTo,
      orderBy: orderByParameter,
      startAfter: startAfterParameter,
    } = options;

    const database = await this._getDatabase();
    let query = (collectionGroupName
      ? database.collectionGroup(collectionGroupName)
      : database.collection(this.getCollectionPath(getCollectionPathArgument))) as unknown as Query<
      z.infer<T['data']>
    >;

    if (filters) {
      for (const { field, operator, value } of filters) {
        query = query.where(field === 'id' ? documentId() : field, operator, value);
      }
    }

    if (orderByParameter) {
      query = query.orderBy(orderByParameter.field, orderByParameter.order);
    }
    if (startAfterParameter) {
      query = query.startAfter(startAfterParameter);
    }

    if (limitTo) {
      query = query.limit(limitTo);
    }

    return query;
  }

  private async _getDatabase(): Promise<Firestore> {
    if (BackendRepository._database) {
      return BackendRepository._database;
    }
    await Promise.resolve();
    // const { database } = await import('@aikami/backend/configs/database');
    BackendRepository._database = getFirestore();
    return BackendRepository._database!;
  }
}
