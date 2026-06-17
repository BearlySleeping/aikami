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
