// packages/backend/configs/src/lib/empty-environment.ts
/**
 * We have an empty env to support sveltekit and node at the same time.
 * For sveltekit we link it to the actual environment variables.
 */
export const env: Record<string, string | undefined> | undefined = undefined;

export default env;
