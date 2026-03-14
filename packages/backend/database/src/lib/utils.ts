import process from 'node:process';
import { getFirestore } from '@aikami/backend/configs/database';
import { documentId } from '@aikami/backend/configs/firestore';
import { getBatch } from '@aikami/backend/utils/batch';
import type {
  BackendQuery,
  CoreData,
  CoreUpdateData,
  GetBaseQueryOptions,
  PostSortDocuments,
  QueryFilter,
} from '@aikami/types';
import { toCoreData } from '@aikami/utils';
import type {
  CollectionGroup,
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Query,
} from '@google-cloud/firestore';
import logger from '$logger';

/**
 * Updates an array of documents
 *
 * @param documents the documents to update
 * @param update a functions to update the documents, return undefined to skip
 *   updating the document
 */
export const updateDocuments = async <Data extends CoreData, UpdateData extends CoreUpdateData>(
  documents: DocumentSnapshot[],
  update: (
    document: Data,
  ) => Partial<UpdateData> | Promise<Partial<UpdateData> | undefined> | undefined,
  { merge = false } = {},
): Promise<void> => {
  const batchArray = [getFirestore().batch()];
  let operationCounter = 0;
  let batchIndex = 0;

  const handleDocument = async (document: DocumentSnapshot) => {
    const updateData = await update(toCoreData(document));
    if (!updateData) {
      return;
    }

    const batch = batchArray[batchIndex];
    if (!batch) {
      throw new Error(`Batch is undefined at index ${batchIndex}`);
    }

    if (merge) {
      batch.set(document.ref, updateData as Partial<unknown>, {
        merge: true,
      });
    } else {
      batch.update(document.ref, updateData as Partial<unknown>);
    }

    operationCounter++;

    if (operationCounter > 498) {
      batchArray.push(getFirestore().batch());
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
};

/**
 * Updates an array of documents
 *
 * @param documents the documents to update
 * @param handle a functions to handle the documents, returns the amount of
 *   batch operations
 */
export const batchQuery = async <Data extends CoreData>(
  documents: DocumentSnapshot[],
  handle: (options: {
    batch: FirebaseFirestore.WriteBatch;
    document: DocumentSnapshot<Data>;
  }) => number | Promise<number>,
): Promise<void> => {
  const batchArray = [getFirestore().batch()];
  let operationCounter = 0;
  let batchIndex = 0;

  const handleQuery = async (document: DocumentSnapshot<Data>) => {
    const batch = batchArray[batchIndex];
    if (!batch) {
      throw new Error('Batch is undefined');
    }
    const operationsAmount = await handle({
      batch,
      document,
    });

    operationCounter += operationsAmount;

    if (operationCounter > 498) {
      batchArray.push(getFirestore().batch());
      batchIndex++;
      operationCounter = 0;
    }
  };

  const baseBatch = getBatch();

  for (const document of documents) {
    baseBatch.push(() => handleQuery(document as DocumentSnapshot<Data>));
  }

  await baseBatch.commit();

  await Promise.all(batchArray.map((batch) => batch.commit()));
};

/**
 * Deletes an array of documents
 *
 * @param documents the documents to delete
 * @param shouldDelete return true if you should delete the document
 */
export const deleteDocuments = async <Data extends CoreData>(
  documents: DocumentSnapshot[],
  shouldDelete?: (document: Data) => boolean | Promise<boolean>,
): Promise<void> => {
  const batchArray = [getFirestore().batch()];
  let operationCounter = 0;
  let batchIndex = 0;

  const handleQuery = async (document: DocumentSnapshot) => {
    if (shouldDelete && !(await shouldDelete(toCoreData(document)))) {
      return;
    }
    batchArray[batchIndex]?.delete(document.ref);
    operationCounter++;

    if (operationCounter > 498) {
      batchArray.push(getFirestore().batch());
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
};

/**
 * Deletes an array of documents based on the the documents refs only
 *
 * @param references the ref of the documents to delete
 */
export const deleteCollectionReferences = async (
  references: DocumentReference[],
): Promise<void> => {
  const batchArray = [getFirestore().batch()];
  let operationCounter = 0;
  let batchIndex = 0;

  for (const reference of references) {
    batchArray[batchIndex]?.delete(reference);
    operationCounter++;

    if (operationCounter > 498) {
      batchArray.push(getFirestore().batch());
      batchIndex++;
      operationCounter = 0;
    }
  }

  await Promise.all(batchArray.map((batch) => batch.commit()));
};

/**
 * Deletes a collection or documents based on a query
 *
 * @param query The query or collection to be deleted
 * @param limit The limit of documents to delete in a single batch (default:
 *   400, max: 500)
 */
export const deleteQuery = async (
  query: CollectionGroup | CollectionReference | Query,
  limit = 400,
): Promise<void> => {
  query = query.orderBy('createdAt').limit(limit);
  await new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
};

const deleteQueryBatch = async (
  query: Query,
  resolve: (value?: unknown) => void,
): Promise<void> => {
  const snapshot = await query.get();

  if (snapshot.size === 0) {
    // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = getFirestore().batch();
  for (const document of snapshot.docs) {
    batch.delete(document.ref);
  }
  await batch.commit();

  // Recurse on the next process tick, to avoid
  // exploding the stack.
  process.nextTick((): Promise<void> => {
    return deleteQueryBatch(query, resolve);
  });
};

export const getDocument = async <T extends CoreData>(path: string): Promise<T | undefined> => {
  try {
    const documentSnap = await getFirestore().doc(path).get();

    if (!documentSnap.exists) {
      return;
    }

    return toCoreData<T>(documentSnap);
  } catch (error) {
    logger.error('getDocument', error);
    return;
  }
};

export const updateDocument = async <T extends CoreUpdateData>(
  path: string,
  data: Partial<T>,
): Promise<boolean> => {
  try {
    await getFirestore().doc(path).update(data);
    return true;
  } catch (error) {
    logger.error('updateDocument', error);
    return false;
  }
};

export const getDocumentsWhere = async <T extends CoreData>(
  options: GetBaseQueryOptions<T> & {
    collectionPath: string;
    filters: QueryFilter<T>[];
  },
  postSort?: PostSortDocuments<T>,
): Promise<T[]> => {
  try {
    logger.debug('getDocumentsWhere', options);
    const query = getQuery(options);
    const querySnap = await query.get();
    const documents = querySnap.docs.map((documentSnap) => toCoreData<T>(documentSnap));
    return postSort ? postSort(documents) : documents;
  } catch (error) {
    logger.error('getDocumentsWhere', error);
    return [];
  }
};

export const getDocumentsAmountWhere = async <T extends CoreData>(
  options: GetBaseQueryOptions<T> & {
    collectionPath: string;
    filters: QueryFilter<T>[];
  },
): Promise<number | undefined> => {
  try {
    logger.debug('getDocumentsAmountWhere', options);
    const query = getQuery(options);
    const querySnap = await query.count().get();
    return querySnap.data().count;
  } catch (error) {
    logger.error('getDocumentsAmountWhere', error);
    return;
  }
};

const getQuery = <T extends CoreData>(
  options: GetBaseQueryOptions<T> & {
    collectionPath: string;
    filters: QueryFilter<T>[];
  },
): BackendQuery => {
  const {
    collectionPath,
    filters,
    limit: limitTo,
    orderBy: orderByParameter,
    startAfter: startAfterParameter,
  } = options;

  let querySnap = getFirestore().collection(collectionPath) as BackendQuery;
  for (const { field, operator, value } of filters) {
    querySnap = querySnap.where(field === 'id' ? documentId() : field, operator, value);
  }

  if (orderByParameter) {
    querySnap = querySnap.orderBy(orderByParameter.field, orderByParameter.order);
  }
  if (startAfterParameter) {
    querySnap = querySnap.startAfter(startAfterParameter);
  }

  if (limitTo) {
    querySnap = querySnap.limit(limitTo);
  }
  return querySnap;
};

export const getDocuments = async <T extends CoreData>(path: string): Promise<T[]> => {
  const querySnap = await getFirestore().collection(path).get();
  if (querySnap.empty) {
    return [];
  }
  return querySnap.docs.map((document) => toCoreData<T>(document));
};
