// Type declarations for Vite's worker import syntax.
// `import W from './worker.ts?worker'` creates a Worker constructor.
declare module '*?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module '*?worker&inline' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}
