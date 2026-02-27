import { runFunctions } from '@aikami/utils';

export type BatchInterface = {
  push(...promise: AsyncFunction<unknown>[]): void;
  commit(): Promise<void>;
};
type AsyncFunction<T> = () => Promise<T>;

class Batch implements BatchInterface {
  private _promises: AsyncFunction<unknown>[] = [];
  private _concurrency = 5;
  async commit(): Promise<void> {
    await runFunctions(this._promises, this._concurrency);
    this._promises = [];
  }
  push(...promise: AsyncFunction<unknown>[]): void {
    this._promises.push(...promise);
  }
}
/**
 * Limit the amount of concurrent executions of a function.
 *
 * @returns A function that accepts a function to limit.
 */
export const getBatch = (): BatchInterface => new Batch();
