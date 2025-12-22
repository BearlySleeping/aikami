export type HttpsCallable = (
  // deno-lint-ignore ban-types
  data?: {} | null,
  // deno-lint-ignore no-explicit-any
) => Promise<{ readonly data: any }>
