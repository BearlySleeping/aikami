export type RouteType = 'public' | 'authenticated' | 'unauthenticated';

export type Route = {
  queryParameters: Record<string, string | number | boolean | undefined> | undefined;
  // biome-disable-next-line noExplicitAny
  getPath: (parameters: any) => string;
  routeId: string;
  type: RouteType;
};

export type Routes = Record<string, Route>;
