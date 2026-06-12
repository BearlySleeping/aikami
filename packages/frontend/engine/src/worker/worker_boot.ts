// packages/frontend/engine/src/worker/worker_boot.ts
// Bootstrapper to catch top-level evaluation errors in the actual worker.
self.onerror = (event: string | Event) => {
  const evt = event instanceof ErrorEvent ? event : undefined;
  postMessage({
    type: 'ENGINE_ERROR',
    message: `Boot error: ${evt?.message || String(event)} @ ${evt?.filename}:${evt?.lineno}`,
  });
};

self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  postMessage({
    type: 'ENGINE_ERROR',
    message: `Boot rejection: ${event.reason?.message || String(event.reason)}`,
  });
};

import('./ecs_worker.ts').catch((err) => {
  postMessage({
    type: 'ENGINE_ERROR',
    message: `Worker import failed: ${err?.message || String(err)}\n${err?.stack || ''}`,
  });
});
