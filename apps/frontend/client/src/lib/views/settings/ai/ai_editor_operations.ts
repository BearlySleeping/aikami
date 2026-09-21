// apps/frontend/client/src/lib/views/settings/ai/ai_editor_operations.ts
//
// Small ownership helper for editor-scoped async work. Each editor operation
// (draft verification, model discovery, model chat-test) owns one instance.
// `begin()` starts a new operation and invalidates the previous one, so a
// result can only land while it is still the newest operation for its slot.
// `invalidate()` is called when the thing the work belongs to changes —
// cancel, provider/model switch, replacement session, or disposal.
//
// An AbortController is owned per operation and aborted on invalidation so a
// request whose capability supports cancellation stops promptly. Callers MUST
// still re-check `isCurrent()` before writing state: cancellation can race the
// response and some transports ignore the signal entirely.

export type EditorOperationRun = {
  generation: number;
  signal: AbortSignal;
};

export class EditorOperation {
  private _generation = 0;
  private _controller: AbortController | undefined;

  /** Starts a new operation, invalidating and aborting any previous one. */
  begin(): EditorOperationRun {
    this._generation += 1;
    this._controller?.abort();
    this._controller = new AbortController();
    return { generation: this._generation, signal: this._controller.signal };
  }

  /** Invalidates the current operation without starting a new one. */
  invalidate(): void {
    this._generation += 1;
    this._controller?.abort();
    this._controller = undefined;
  }

  /** True when `generation` still belongs to the newest operation. */
  isCurrent(generation: number): boolean {
    return this._generation === generation;
  }

  /** Releases the controller once its operation has settled. */
  settle(generation: number): void {
    if (this._generation === generation) {
      this._controller = undefined;
    }
  }
}
