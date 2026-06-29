// packages/frontend/engine/src/vite-worker.d.ts
//
// Type declarations for Vite's worker import syntax.
// `import W from './worker.ts?worker'` creates a Worker constructor.
// Required for tsc to understand the `?worker` suffix used in game_world.ts.

declare module '*?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module '*?worker&type=module' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

// ---------------------------------------------------------------------------
// Contract C-195: Optional peer dependencies for string registry hydration
// ---------------------------------------------------------------------------

/**
 * Ambient declaration for the optional @libsql/client peer dependency.
 * Used by {@link TursoRegistryHydration} for dynamic import at runtime.
 * When the package is not installed, the bridge operates in stub mode.
 */
declare module '@libsql/client' {
  export const createClient: (options: { url: string; authToken: string }) => {
    execute: (sql: string) => Promise<{ rows: Array<{ id: number; value: string }> }>;
  };
}

/**
 * Ambient declaration for the optional @firebase/data-connect peer dependency.
 * Used by {@link FirebaseSqlConnectSync} for dynamic import at runtime.
 * When the package is not installed, the bridge operates in stub mode.
 */
declare module '@firebase/data-connect' {
  // Placeholder — Firebase Data Connect SDK API is still evolving.
  // Actual subscription pattern will be wired when the SDK stabilizes.
}
