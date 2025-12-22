class Deferred<T, E> {
  readonly promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void = () => undefined
  reject: (reason?: E) => void = () => undefined
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}
/**
 * This function creates a new Deferred class instance, to be used for async
 * operations.
 *
 * @example
 *
 * ```ts
 * export function recordStreamAsBlob(stream: MediaStream) {
 * 	const recorder = new MediaRecorder(stream);
 * 	const chunks: Blob[] = [];
 * 	const deferredBlob = createDeferred<Blob, Error>();
 *
 * 	recorder.ondataavailable = (event) => chunks.push(event.data);
 * 	recorder.onstop = () => {
 * 		deferredBlob.resolve(new Blob(chunks));
 * 	};
 * 	recorder.start();
 *
 * 	return () => {
 * 		recorder.stop();
 * 		deferredBlob.promise;
 * 	};
 * }
 * ```
 *
 * @returns a new deferred class instance.
 */
export const createDeferred = <T, E>(): Deferred<T, E> => new Deferred<T, E>()
