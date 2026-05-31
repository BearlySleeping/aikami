export type RouteType = 'public' | 'authenticated' | 'unauthenticated';

export type Route = {
  queryParameters: Record<string, string | number | boolean | undefined> | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: route parameters can be any shape
  getPath: (parameters: any) => string;
  routeId: string;
  type: RouteType;
};

export type Routes = Record<string, Route>;
