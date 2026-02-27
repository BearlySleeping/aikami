/// <reference types="../env.d.ts" />

import type {
  BatchCommand,
  DocumentListener,
  DocumentObservable,
  DocumentsListener,
  DocumentsObservable,
  FieldValue,
  GetQueryOptions,
  PostSortDocuments,
  QueryFilter,
  RepositoryType,
  ServerArrayRemove,
  ServerArrayUnion,
  ServerDelete,
  ServerIncrement,
  ServerTimestamp,
} from '@aikami/types';
import {
  BaseRepository,
  type BaseRepositoryInterface,
  type BaseRepositoryOptions,
} from '@aikami/utils';
import type {
  CollectionReference,
  DocumentChange,
  DocumentReference,
  DocumentSnapshot,
  FirestoreError,
  Query,
  QueryConstraint,
  QuerySnapshot,
  Timestamp,
  Unsubscribe,
  WriteBatch,
} from 'firebase/firestore';
import type { z } from 'zod';

export type { QueryFilter, RepositoryType };

type Database = typeof import('@aikami/frontend/services/firebase/configs/firestore.ts');

type CustomTimestamp = {
  _seconds: number;
  _nanoseconds: number;
};

// Type guard to check if an object is a CustomTimestamp
const isCustomTimestamp = (obj: unknown): obj is CustomTimestamp => {
  return (
    !!obj &&
    typeof obj === 'object' &&
    '_seconds' in obj &&
    '_nanoseconds' in obj &&
    typeof obj._seconds === 'number' &&
    typeof obj._nanoseconds === 'number'
  );
};

export type FrontendRepositoryInterface<T extends RepositoryType> = {
  getDocumentsStreamByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    postSort?: PostSortDocuments<z.infer<T['data']>>,
  ): Promise<DocumentsObservable<z.infer<T['data']>>>;
  getDocumentStream(
    getDocumentPathArgument: T['getDocumentPathArgument'],
  ): Promise<DocumentObservable<z.infer<T['data']>>>;

  getFieldOperators(): Promise<{
    arrayUnion: ServerArrayUnion;
    serverIncrement: ServerIncrement;
    serverTimestamp: ServerTimestamp;
    arrayRemove: ServerArrayRemove;
    serverDelete: ServerDelete;
    documentId: () => FieldValue;
    Timestamp: typeof Timestamp;
  }>;

  getRawCollectionReference(collectionPath: string): Promise<CollectionReference>;

  getRawDocumentReference(documentPath: string): Promise<DocumentReference>;

  getNewDocumentIdFunction(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<() => string>;

  getDocumentsStreamMultipleQuery(
    queries: Query<z.infer<T['data']>>[],
    postSort?: PostSortDocuments<z.infer<T['data']>>,
  ): Promise<DocumentsObservable<z.infer<T['data']>>>;

  getRawQuery(query: {
    filters: QueryFilter<z.infer<T['data']>>[];
    collectionPath: string;
  }): Promise<Query<z.infer<T['data']>>>;

  getQueryCount(query: Query): Promise<number>;

  getDocumentsByGroupQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<z.infer<T['data']>[]>;

  getDocumentsByRawQuery(query: Query): Promise<z.infer<T['data']>[]>;

  // commit(batchCommands: BatchCommand[]): Promise<void>;
  getWriteBatch(): Promise<WriteBatch>;
} & BaseRepositoryInterface<T>;

export class FrontendRepository<T extends RepositoryType>
  extends BaseRepository<T>
  implements FrontendRepositoryInterface<T>
{
  private static _database?: Database;

  constructor(options: BaseRepositoryOptions<T>) {
    super({
      ...options,
      parseLevel: options.parseLevel ?? import.meta.env.PUBLIC_PARSE_LEVEL,
    });
  }

  async getDocument(
    getDocumentPathArguments: T['getDocumentPathArgument'],
  ): Promise<z.infer<T['data']> | undefined> {
    const [{ getDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference<z.infer<T['data']>>(getDocumentPathArguments),
    ]);

    const documentSnap = await getDoc(documentReference);
    if (!documentSnap.exists()) {
      return;
    }

    const data = this.toData(documentSnap);
    return this.parse('data', data);
  }

  async getDocumentsByCollection(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<z.infer<T['data']>[]> {
    const [{ getDocs }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference<z.infer<T['data']>>(getCollectionPathArgument),
    ]);

    const querySnapshot = await getDocs(collectionReference);
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs);
  }
  async getNewDocumentId(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<string> {
    const [{ doc }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference(getCollectionPathArgument),
    ]);

    const newDocumentId = doc(collectionReference).id;
    return newDocumentId;
  }
  async getNewDocumentIdFunction(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<() => string> {
    const [{ doc }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference(getCollectionPathArgument),
    ]);

    return () => doc(collectionReference).id;
  }
  async getDocumentsByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<z.infer<T['data']>[]> {
    const [{ getDocs }, currentQuery] = await Promise.all([
      this._getDatabase(),
      this.getQuery(query),
    ]);

    const querySnapshot = await getDocs(currentQuery);
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs);
  }
  async getDocumentsByRawQuery(query: Query): Promise<z.infer<T['data']>[]> {
    const [{ getDocs }] = await Promise.all([this._getDatabase()]);

    const querySnapshot = await getDocs(query);
    if (querySnapshot.empty) {
      return [];
    }
    return this.parseDocuments(querySnapshot.docs);
  }
  async getDocumentsStreamByQuery(
    query: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
    postSort?: PostSortDocuments<z.infer<T['data']>>,
  ): Promise<DocumentsObservable<z.infer<T['data']>>> {
    // if (!this._snapshotListenerSupported) {
    // 	return (
    // 		listener: DocumentsListener<z.infer<T['data']>>,
    // 		onError?: (error: FirestoreError) => void,
    // 		onCompletion?: () => void,
    // 	) => {
    // 		const fetchDocuments = async () => {
    // 			try {
    // 				const documents = await this.getDocumentsByQuery(query);

    // 				void listener(
    // 					postSort ? postSort(documents) : documents,
    // 				);
    // 			} catch (error) {
    // 				this.error('getDocumentsStreamByQuery', error);
    // 				onError?.(error as FirestoreError);
    // 			}
    // 			onCompletion?.();
    // 		};

    // 		void fetchDocuments();
    // 		return { unsubscribe: () => {} };
    // 	};
    // }

    const [{ onSnapshot }, currentQuery] = await Promise.all([
      this._getDatabase(),
      this.getQuery(query),
    ]);
    return (
      listener: DocumentsListener<z.infer<T['data']>>,
      onError?: (error: FirestoreError) => void,
      onCompletion?: () => void,
      onDeleted?: (ids: string[]) => void,
    ) => {
      let completed = false;
      const unsubscribe = onSnapshot(
        currentQuery,
        async (querySnapshot: QuerySnapshot<z.infer<T['data']>>) => {
          const documents = await this.parseDocuments(querySnapshot.docs);

          void listener(postSort ? postSort(documents) : documents);
          const deletedIds = querySnapshot
            .docChanges()
            .filter((change: DocumentChange<z.infer<T['data']>>) => change.type === 'removed')
            .map((change: DocumentChange<z.infer<T['data']>>) => change.doc.id);

          if (deletedIds.length > 0) {
            onDeleted?.(deletedIds);
          }

          if (completed) {
            return;
          }
          completed = true;
          onCompletion?.();
        },
        (error: FirestoreError) => {
          this.error('getDocumentsStreamByQuery', error);
          onError?.(error);
        },
        () => {
          if (completed) {
            return;
          }
          completed = true;
          onCompletion?.();
        },
      );

      return { unsubscribe };
    };
  }
  async getDocumentsByGroupQuery(
    options: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<z.infer<T['data']>[]> {
    const [{ getDocs }, currentQuery] = await Promise.all([
      this._getDatabase(),
      this.getQuery(options),
    ]);

    const querySnapshot = await getDocs(currentQuery);
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs);
  }
  async addDocument({
    createData,
    getCollectionPathArgument,
  }: {
    getCollectionPathArgument: T['getCollectionPathArgument'];
    createData: Omit<z.infer<T['createData']>, 'createdAt'>;
  }): Promise<string> {
    const [{ addDoc, serverTimestamp }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference(getCollectionPathArgument),
    ]);

    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...createData,
    });

    const response = await addDoc(collectionReference, data);

    return response.id;
  }
  async commit(batchCommands: BatchCommand[]): Promise<void> {
    const batch = await this.getWriteBatch();

    const addToBatchCommand = async ({ data, documentPathArgument, type }: BatchCommand) => {
      const documentReference = await this.getDocumentReference(documentPathArgument);
      switch (type) {
        case 'set':
          batch.set(documentReference, data as z.infer<T['createData']>);
          break;
        case 'update':
          batch.update(documentReference, data);
          break;
        case 'delete':
          batch.delete(documentReference);
          break;
      }
    };

    await Promise.all(batchCommands.map(addToBatchCommand));

    await batch.commit();
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
    const [{ serverTimestamp, setDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference(getDocumentPathArgument),
    ]);

    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...setData,
    });

    await setDoc(documentReference, data, {
      merge: options?.merge,
    });
  }
  async deleteDocument(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<void> {
    const [{ deleteDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference(getDocumentPathArgument),
    ]);
    await deleteDoc(documentReference);
  }
  async deleteDocuments(getDocumentPathArguments: T['getDocumentPathArgument'][]): Promise<void> {
    const { firestore, writeBatch } = await this._getDatabase();
    const batch = writeBatch(firestore);

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

  async getDocumentsStreamMultipleQuery(
    queries: Query<z.infer<T['data']>>[],
    postSort?: PostSortDocuments<z.infer<T['data']>>,
  ): Promise<DocumentsObservable<z.infer<T['data']>>> {
    // if (!this._snapshotListenerSupported) {
    // 	return (
    // 		listener: DocumentsListener<z.infer<T['data']>>,
    // 		onError?: (error: FirestoreError) => void,
    // 		onCompletion?: () => void,
    // 	) => {
    // 		const fetchDocuments = async () => {
    // 			try {
    // 				const documents = await Promise.all(
    // 					queries.map(async (query) => {
    // 						return this.getDocumentsByRawQuery(query);
    // 					}),
    // 				);

    // 				void listener(
    // 					postSort
    // 						? postSort(documents.flat())
    // 						: documents.flat(),
    // 				);
    // 			} catch (error) {
    // 				this.error('getDocumentsStreamByQuery', error);
    // 				onError?.(error as FirestoreError);
    // 			}
    // 			onCompletion?.();
    // 		};

    // 		void fetchDocuments();
    // 		return { unsubscribe: () => {} };
    // 	};
    // }

    const documents: z.infer<T['data']>[] = [];
    const unsubscribes: Unsubscribe[] = [];
    const { onSnapshot } = await this._getDatabase();
    let completionCount = 0;
    return (
      listener: DocumentsListener<z.infer<T['data']>>,
      onError?: (error: FirestoreError) => void,
      onCompletion?: () => void,
    ) => {
      for (const query of queries) {
        unsubscribes.push(
          onSnapshot(
            query,
            async (querySnapshot: QuerySnapshot<z.infer<T['data']>>) => {
              const newDocuments = await this.parseDocuments(querySnapshot.docs);
              this.log('----newDocuments', newDocuments);

              for (const newDocument of newDocuments) {
                const index = documents.findIndex((d) => d.id === newDocument.id);
                if (index === -1) {
                  documents.push(newDocument);
                } else {
                  documents[index] = newDocument;
                }
              }
              void listener(postSort ? postSort(documents) : documents);
            },
            (error: FirestoreError) => {
              this.error('getDocumentsStreamMultipleQuery', error);
              onError?.(error);
            },
            () => {
              completionCount++;
              if (completionCount === queries.length) {
                onCompletion?.();
              }
            },
          ),
        );
      }

      return { unsubscribe: () => unsubscribes.forEach((u) => u()) };
    };
  }
  /**
   * async NB: You cannot order your query by any field included in an
   * equality (=) or in clause.
   * https://firebase.google.com/docs/firestore/query-data/order-limit-data#limitations
   *
   * @param options - Options
   * @returns Query
   */
  async getRawQuery(options: {
    filters: QueryFilter<z.infer<T['data']>>[];
    collectionPath: string;
  }): Promise<Query<z.infer<T['data']>>> {
    const { collection, documentId, firestore, query, where } = await this._getDatabase();
    const { collectionPath, filters } = options;
    const constraints: QueryConstraint[] = [];
    for (const { field, operator, value } of filters) {
      constraints.push(where(field === 'id' ? documentId() : field, operator, value));
    }

    this.debug('getQuery', constraints);

    return query<z.infer<T['data']>, z.infer<T['data']>>(
      // @ts-expect-error Firebase don't require index signature
      collection(firestore, collectionPath),
      ...constraints,
    );
  }
  async getDocumentStream(
    getDocumentPathArgument: T['getDocumentPathArgument'],
  ): Promise<DocumentObservable<z.infer<T['data']>>> {
    // if (!this._snapshotListenerSupported) {
    // 	return (
    // 		listener: DocumentListener<z.infer<T['data']>>,
    // 		onError?: (error: FirestoreError) => void,
    // 		onCompletion?: () => void,
    // 	) => {
    // 		const fetchDocuments = async () => {
    // 			try {
    // 				const document = await this.getDocument(
    // 					getDocumentPathArgument,
    // 				);

    // 				void listener(document);
    // 			} catch (error) {
    // 				this.error('getDocumentsStreamByQuery', error);
    // 				onError?.(error as FirestoreError);
    // 			}
    // 			onCompletion?.();
    // 		};

    // 		void fetchDocuments();
    // 		return { unsubscribe: () => {} };
    // 	};
    // }

    const { onSnapshot } = await this._getDatabase();
    const documentReference =
      await this.getDocumentReference<z.infer<T['data']>>(getDocumentPathArgument);

    return (
      listener: DocumentListener<z.infer<T['data']>>,
      onError?: (error: FirestoreError) => void,
      onCompletion?: () => void,
    ) => {
      const unsubscribe = onSnapshot(
        documentReference,
        async (documentSnapshot: DocumentSnapshot<z.infer<T['data']>>) => {
          void listener(
            documentSnapshot.exists()
              ? await this.parse('data', this.toData(documentSnapshot))
              : undefined,
          );
        },
        (error: FirestoreError) => {
          this.error('getDocumentStream', error);
          onError?.(error);
        },
        onCompletion,
      );
      return { unsubscribe };
    };
  }
  async getDocumentReference<
    Document extends
      | z.infer<T['data']>
      | z.infer<T['createData']>
      | Partial<z.infer<T['updateData']>>,
  >(documentArgument: T['getDocumentPathArgument']): Promise<DocumentReference<Document>> {
    const { doc, firestore } = await this._getDatabase();

    return doc(firestore, this.getDocumentPath(documentArgument)) as DocumentReference<Document>;
  }

  async updateDocument({
    getDocumentPathArgument,
    options,
    updateData,
  }: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    updateData: Omit<Partial<z.infer<T['updateData']>>, 'updatedAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void> {
    const [{ serverTimestamp, setDoc, updateDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference<Partial<z.infer<T['updateData']>>>(getDocumentPathArgument),
    ]);

    const data = await this.parse('updateData', {
      updatedAt: serverTimestamp(),
      ...updateData,
    });

    if (options?.merge) {
      await setDoc(documentReference, data, {
        merge: true,
      });
    } else {
      await updateDoc(documentReference, data);
    }
  }
  async getWriteBatch(): Promise<WriteBatch> {
    const { firestore, writeBatch } = await this._getDatabase();

    return writeBatch(firestore);
  }
  async getRawCollectionReference(collectionPath: string): Promise<CollectionReference> {
    const { collection, firestore } = await this._getDatabase();

    return collection(firestore, collectionPath);
  }
  async getRawDocumentReference(documentPath: string): Promise<DocumentReference> {
    const { doc, firestore } = await this._getDatabase();

    return doc(firestore, documentPath);
  }
  async getFieldOperators() {
    const {
      arrayRemove,
      arrayUnion,
      deleteField,
      documentId,
      increment,
      serverTimestamp,
      Timestamp: FBTimestamp,
    } = await this._getDatabase();
    return {
      arrayRemove,
      arrayUnion,
      documentId,
      serverDelete: deleteField,
      serverIncrement: increment,
      serverTimestamp,
      Timestamp: FBTimestamp,
    };
  }
  async getQueryCount(query: Query): Promise<number> {
    const { getCountFromServer } = await this._getDatabase();
    const querySnapshot = await getCountFromServer(query);
    return querySnapshot.data().count;
  }
  async getCollectionReference<Document extends z.infer<T['data']> | z.infer<T['createData']>>(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<CollectionReference<Document>> {
    const { collection, firestore } = await this._getDatabase();

    return collection(
      firestore,
      this.getCollectionPath(getCollectionPathArgument),
    ) as CollectionReference<Document>;
  }
  async getCollectionGroupReference<Document extends z.infer<T['data']> | z.infer<T['createData']>>(
    collectionGroupName: string,
  ): Promise<Query<Document>> {
    const { collectionGroup, firestore } = await this._getDatabase();

    return collectionGroup(firestore, collectionGroupName) as Query<Document>;
  }
  /**
   * async NB: You cannot order your query by any field included in an
   * equality (=) or in clause.
   * https://firebase.google.com/docs/firestore/query-data/order-limit-data#limitations
   *
   * @param options - Options
   * @param collectionGroupName - Collection group name
   * @returns Query
   */
  async getQuery(
    options: GetQueryOptions<z.infer<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Query<z.infer<T['data']>>> {
    const { documentId, limit, orderBy, query, startAfter, Timestamp, where } =
      await this._getDatabase();

    const { filters, limit: limitTo, orderBy: orderByParameter } = options;
    let startAfterParameter = options.startAfter;
    this.debug('getQuery:baseQueryOptions', options);

    const constraints: QueryConstraint[] = [];
    if (filters) {
      for (const { field, operator, value } of filters) {
        constraints.push(where(field === 'id' ? documentId() : field, operator, value));
      }
    }

    if (orderByParameter !== null) {
      constraints.push(
        orderByParameter
          ? orderBy(orderByParameter.field, orderByParameter.order)
          : orderBy('createdAt', 'desc'),
      );
    }
    if (startAfterParameter) {
      // If startAfterParameter is a timestamp, ensure it is a firestore timestamp
      if (isCustomTimestamp(startAfterParameter)) {
        // Convert seconds to milliseconds and add nanoseconds converted to milliseconds
        const millis =
          startAfterParameter._seconds * 1000 + startAfterParameter._nanoseconds / 1000000;
        startAfterParameter = Timestamp.fromMillis(millis);
      }

      constraints.push(startAfter(startAfterParameter));
    }

    if (limitTo) {
      constraints.push(limit(limitTo));
    }

    return query<z.infer<T['data']>, z.infer<T['data']>>(
      // @ts-expect-error Firebase require index signature
      options.collectionGroupName
        ? await this.getCollectionGroupReference(options.collectionGroupName)
        : await this.getCollectionReference(options.getCollectionPathArgument),
      ...constraints,
    );
  }

  private async _getDatabase(): Promise<Database> {
    if (FrontendRepository._database) {
      return FrontendRepository._database;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FrontendRepository._database = await import(
      '@aikami/frontend/services/firebase/configs/firestore.ts'
    );
    return FrontendRepository._database;
  }

  // private get _snapshotListenerSupported(): boolean {
  // 	if (typeof window === 'undefined') {
  // 		return false;
  // 	}

  // 	return true;
  // }
}
