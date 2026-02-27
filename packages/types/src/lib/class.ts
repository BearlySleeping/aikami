import type { FirestoreError } from 'firebase/firestore';

export type Subscription = {
  unsubscribe: () => void;
};

export type Listener<T> = (document?: T) => void | Promise<void>;

export type Observable<T> = (
  listener: Listener<T>,
  onError?: (error: FirestoreError) => void,
  onCompletion?: () => void,
  onDeleted?: (ids: string[]) => void,
) => Subscription;
