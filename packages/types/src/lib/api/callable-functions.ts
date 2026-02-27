export type HttpsCallable = (
  // biome-disable-next-line ban-types
  data?: {} | null,
  // biome-disable-next-line no-explicit-any
) => Promise<{ readonly data: any }>;
