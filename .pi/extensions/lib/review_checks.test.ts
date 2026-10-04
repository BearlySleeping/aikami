// .pi/extensions/lib/review_checks.test.ts

import { describe, expect, test } from 'bun:test';
import { waitForCheckCompletion } from './review_checks.ts';

const noReport = () => {};

describe('waitForCheckCompletion', () => {
  test('waits through exit 8 before accepting completed structured checks', async () => {
    let queries = 0;
    const reports: string[] = [];
    const ready = await waitForCheckCompletion({
      pr: '123',
      report: (line) => reports.push(line),
      intervalMs: 1,
      queryChecks: async () => {
        queries++;
        return {
          success: true,
          code: queries === 1 ? 8 : 0,
          text: '',
          json: [{ bucket: queries === 1 ? 'pending' : 'pass' }],
        };
      },
    });
    expect(ready).toBe(true);
    expect(queries).toBe(2);
    expect(reports.some((line) => line.includes('1 check(s) pending'))).toBe(true);
  });

  test('failed GitHub queries cannot become completed CI', async () => {
    const reports: string[] = [];
    await expect(
      waitForCheckCompletion({
        pr: '123',
        report: (line) => reports.push(line),
        queryChecks: async () => ({ success: false, code: 1, text: 'auth failed' }),
      }),
    ).rejects.toThrow('Cannot establish CI check completion');
    expect(reports.some((line) => line.includes('All CI checks completed'))).toBe(false);
  });

  test('checkless PRs preserve the diagnostic and cannot authorize completed CI', async () => {
    const reports: string[] = [];
    await expect(
      waitForCheckCompletion({
        pr: '123',
        report: (line) => reports.push(line),
        queryChecks: async () => ({
          success: true,
          code: 1,
          text: '',
          stderr: 'no checks reported on branch',
        }),
      }),
    ).rejects.toThrow('no checks reported on branch');
    expect(reports.some((line) => line.includes('All CI checks completed'))).toBe(false);
  });

  test('cancellation prevents querying or reporting CI completion', async () => {
    let queries = 0;
    expect(
      await waitForCheckCompletion({
        pr: '123',
        report: noReport,
        signal: AbortSignal.abort(),
        queryChecks: async () => {
          queries++;
          return { success: true, code: 0, text: '', json: [{ bucket: 'pass' }] };
        },
      }),
    ).toBe(false);
    expect(queries).toBe(0);
  });

  test('cancellation during a query cannot produce a completed-CI verdict', async () => {
    const controller = new AbortController();
    expect(
      await waitForCheckCompletion({
        pr: '123',
        report: noReport,
        signal: controller.signal,
        queryChecks: async () => {
          controller.abort();
          return { success: true, code: 0, text: '', json: [{ bucket: 'pass' }] };
        },
      }),
    ).toBe(false);
  });

  test('still-pending checks return false at the bounded deadline', async () => {
    let queries = 0;
    expect(
      await waitForCheckCompletion({
        pr: '123',
        report: noReport,
        maxWaitMs: 30,
        intervalMs: 1,
        queryChecks: async () => {
          queries++;
          return { success: true, code: 8, text: '', json: [{ bucket: 'pending' }] };
        },
      }),
    ).toBe(false);
    expect(queries).toBeGreaterThan(0);
  });
});
