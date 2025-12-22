export type RouteType = 'public' | 'authenticated' | 'unauthenticated'

export type Route = {
  queryParameters:
    | Record<string, string | number | boolean | undefined>
    | undefined
  // deno-lint-ignore no-explicit-any
  getPath: (parameters: any) => string
  routeId: string
  type: RouteType
}

export type Routes = Record<string, Route>
