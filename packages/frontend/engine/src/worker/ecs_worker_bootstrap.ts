// packages/frontend/engine/src/worker/ecs_worker_bootstrap.ts
//
// Bootstrap entry point for the ECS worker.
//
// ALL error handling is set up BEFORE any imports so that module-level
// evaluation errors in imported dependencies are caught and reported.
// Static imports in ecs_worker.ts execute before self.addEventListener,
// so they silently kill the worker. This thin wrapper fixes that.
//
/// <reference lib="webworker" />

// ── Catch ALL errors before anything else ──
self.addEventListener('error', (event: ErrorEvent): void => {
  const detail = {
    message: event.message || '(no message)',
    filename: event.filename || '(unknown)',
    lineno: event.lineno,
    colno: event.colno,
    errorMessage:
      event.error instanceof Error ? event.error.message : String(event.error ?? 'none'),
    errorStack: event.error instanceof Error ? event.error.stack : undefined,
  };
  try {
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Worker bootstrap error: ${JSON.stringify(detail)}`,
    });
  } catch {
    // If even postMessage fails, nothing we can do
  }
});

self.onerror = (message, source, lineno, colno, _error): boolean => {
  try {
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Worker onerror: ${String(message)} @ ${String(source)}:${lineno}:${colno}`,
    });
  } catch {
    // silent
  }
  return false;
};

self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  try {
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Worker unhandled rejection: ${String(event.reason)}`,
    });
  } catch {
    // silent
  }
};

// ── Confirm bootstrap loaded ──
try {
  postMessage({ type: 'DIAGNOSTIC_MODULE_LOADED', timestamp: Date.now() });
} catch {
  // silent
}

// ── Message queue while real worker loads ──
let _realReady = false;
const _messageQueue: MessageEvent[] = [];

// Save original postMessage so the real worker's monkey-patch doesn't interfere
const _originalPostMessage = self.postMessage.bind(self);

// Forward messages from main thread to the real worker.
// Before the real worker is ready, queue them.
self.onmessage = (event: MessageEvent): void => {
  if (_realReady) {
    return; // real worker's onmessage handles it
  }
  _messageQueue.push(event);
};

// ── Now import the real worker ──
import('./ecs_worker.ts')
  .then(() => {
    _realReady = true;

    // Replay queued messages to the real worker's onmessage handler
    if (_messageQueue.length > 0) {
      for (const queued of _messageQueue) {
        // Invoke the real worker's onmessage (set by ecs_worker.ts)
        if (self.onmessage) {
          (self.onmessage as (ev: MessageEvent) => void)(queued);
        }
      }
      _messageQueue.length = 0;
    }

    try {
      _originalPostMessage({ type: 'BOOTSTRAP_READY' });
    } catch {
      // silent
    }
  })
  .catch((err) => {
    _originalPostMessage({
      type: 'ENGINE_ERROR',
      message: `Worker dynamic import failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  });
