import { mockUserData } from "./user.ts";

export * from "./user.ts";

export const mockData = {
  ...mockUserData,
} as const;
