// apps/frontend/gamejs/src/core/api/http/callback_to_promise.ts
export function callbackToPromise<T>(
    executor: (resolve: (value: T) => void) => void
): Promise<T> {
    return new Promise<T>((resolve) => {
        executor(resolve);
    });
}