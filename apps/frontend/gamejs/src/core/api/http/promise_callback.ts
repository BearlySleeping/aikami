// apps/frontend/gamejs/src/core/api/http/promise_callback.ts
/**
 * Converts a callback-based API to a Promise.
 * Used to wrap providers that don't support Promises directly.
 */
export function callbackToPromise<T>(
    executor: (resolve: (value: T) => void, reject: (error: unknown) => void) => void,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        executor(resolve, reject);
    });
}