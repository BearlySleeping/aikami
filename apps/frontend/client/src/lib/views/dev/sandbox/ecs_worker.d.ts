// apps/frontend/client/src/lib/views/dev/sandbox/ecs_worker.d.ts

declare module '@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module' {
  const EcsWorkerConstructor: new () => Worker;
  export default EcsWorkerConstructor;
}
