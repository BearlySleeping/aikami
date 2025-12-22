import type { CoreData, DocumentSnapshot } from '@aikami/types'

export const toCoreData = <T extends CoreData = CoreData>(
  documentSnap: DocumentSnapshot,
): T =>
  ({
    ...documentSnap.data(),
    id: documentSnap.id,
  }) as T
