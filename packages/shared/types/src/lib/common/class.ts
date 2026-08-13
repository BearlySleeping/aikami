// packages/shared/types/src/lib/common/class.ts
export type Subscription = {
  unsubscribe: () => void;
};

export type Listener<T> = (document?: T) => void | Promise<void>;

export type Observable<T> = (
  listener: Listener<T>,
  onError?: (error: Error) => void,
  onCompletion?: () => void,
  onDeleted?: (ids: string[]) => void,
) => Subscription;
