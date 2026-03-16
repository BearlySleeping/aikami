// packages/backend/configs/src/lib/empty-environment.ts
/**
 * We have a empty env to support sveltekit and node at the same time.
 * So for firebase functions we will link $env/static/private to this file, while
 * for sveltekit we will link it to the actual environment variables.
 */
export const env: Record<string, string | undefined> | undefined = undefined;

export default env;
