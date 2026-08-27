// packages/frontend/preview/src/vite-worker.d.ts
//
// Type declarations for Vite's worker import syntax.
// Required for tsc to understand the `?worker` suffix used in walk_sandbox_view_model.

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
