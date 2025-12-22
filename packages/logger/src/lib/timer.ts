export type TimerInterface = {
  /**
   * Returns the duration in milliseconds. If you have passed sentry
   * TransactionContext to the constructor / createTimer method, it will also
   * finish the transaction and span.
   *
   * NB: this method should only be called once, if you want to keep the timer
   * running, use `getTimeInMS` instead.
   *
   * @returns Duration in ms
   */
  finish(): bigint
  /**
   * Returns the duration in milliseconds. This will not finish the
   * transaction and span. If you want to finish the transaction and span, use
   * `finish` instead.
   *
   * @returns Duration in ms
   */
  getTimeInMS(): bigint
}
export abstract class Timer implements TimerInterface {
  private readonly _start: number // Changed from bigint to number

  constructor() {
    this._start = performance.now() // Changed to performance.now()
  }

  finish(): bigint {
    const durationMs = performance.now() - this._start
    // durationMs is already in milliseconds. Convert to BigInt.
    return BigInt(Math.round(durationMs))
  }

  getTimeInMS(): bigint {
    const durationMs = performance.now() - this._start
    // durationMs is already in milliseconds. Convert to BigInt.
    return BigInt(Math.round(durationMs))
  }
}
