// .pi/extensions/lib/coderabbit_reader.test.ts

import { describe, expect, test } from 'bun:test';
import { codeRabbitFindings } from './coderabbit_evidence.ts';
import {
  type ReviewQuery,
  readCodeRabbitSnapshot,
  validateReviewSelector,
} from './coderabbit_reader.ts';
import { OLD_REVIEW_HEAD, REVIEW_HEAD } from './testing/coderabbit_fixtures.ts';

const metadata = () => ({
  number: 436,
  url: 'https://github.com/base/project/pull/436',
  headRefOid: REVIEW_HEAD,
  headRefName: 'feature',
  isDraft: false,
});
const rootThread = (id: string) => ({
  id,
  isResolved: false,
  isOutdated: false,
  comments: {
    nodes: [
      {
        author: { login: 'coderabbitai[bot]' },
        body: 'finding',
        path: 'file.ts',
        line: 1,
        updatedAt: '2026-10-05T02:30:00Z',
        originalCommit: { oid: REVIEW_HEAD },
        // Incremental roots can belong to a new SHA without a new formal review.
        pullRequestReview: { commit: { oid: OLD_REVIEW_HEAD } },
      },
    ],
  },
});

const connectionFixture = (args: string[]) => {
  const name = ['reviewThreads', 'reviews', 'comments'].find((candidate) =>
    args.some((arg) => arg.includes(`${candidate}(first:`)),
  );
  if (!name) {
    throw new Error('Unknown fixture query');
  }
  const next = name === 'reviewThreads' && !args.includes('cursor=next');
  const nodes =
    name === 'reviewThreads'
      ? Array.from({ length: next ? 100 : 1 }, (_, index) =>
          rootThread(`${next ? 'first' : 'second'}-${index}`),
        )
      : [];
  return {
    data: {
      repository: {
        pullRequest: {
          [name]: {
            totalCount: name === 'reviewThreads' ? 101 : 0,
            nodes,
            pageInfo: { hasNextPage: next, endCursor: next ? 'next' : undefined },
          },
        },
      },
    },
  };
};

const transport =
  (
    options: { calls?: string[][]; modify?: (args: string[], json: unknown) => unknown } = {},
  ): ReviewQuery =>
  async (args) => {
    options.calls?.push(args);
    let json: unknown;
    if (args[0] === 'pr') {
      json = metadata();
    } else if (args[1] !== 'graphql') {
      json = [[]];
    } else {
      json = connectionFixture(args);
    }
    return { success: true, text: '', json: options.modify ? options.modify(args, json) : json };
  };

describe('paginated shared GitHub evidence reader', () => {
  test('reads beyond 100 threads, scopes statuses to exact head and uses the BASE repository', async () => {
    const calls: string[][] = [];
    const snapshot = await readCodeRabbitSnapshot({ pr: '436', query: transport({ calls }) });
    expect(snapshot.repository).toBe('base/project');
    expect(codeRabbitFindings(snapshot).actionableCount).toBe(101);
    expect(
      calls.some((args) =>
        args.includes(`repos/base/project/commits/${REVIEW_HEAD}/statuses?per_page=100`),
      ),
    ).toBe(true);
    expect(
      calls
        .filter((args) => args[1] === 'graphql')
        .every((args) => args.includes('owner=base') && args.includes('repo=project')),
    ).toBe(true);
    expect(calls.some((args) => args.includes('cursor=next'))).toBe(true);
  });
  test('foreign repository URL survives the metadata request', async () => {
    const calls: string[][] = [];
    await readCodeRabbitSnapshot({
      pr: 'https://github.com/base/project/pull/436',
      query: transport({ calls }),
    });
    expect(calls[0]?.[2]).toBe('https://github.com/base/project/pull/436');
  });
  test.each([
    '436 --repo other/repo',
    '--repo=other/repo',
    '',
    'https://evil.example/a/b/pull/436',
  ])('rejects invalid/option-shaped selectors %s', (selector) => {
    expect(() => validateReviewSelector(selector)).toThrow('Invalid');
  });
  test('GitHub transport failures and missing JSON are never empty findings', async () => {
    for (const result of [
      { success: false, text: 'HTTP 502' },
      { success: true, text: 'not JSON' },
    ]) {
      await expect(
        readCodeRabbitSnapshot({ pr: '436', query: async () => result }),
      ).rejects.toThrow('Cannot read');
    }
  });
  test('GraphQL partial results cannot establish findings', async () => {
    await expect(
      readCodeRabbitSnapshot({
        pr: '436',
        query: transport({
          modify: (args, json) =>
            args[1] === 'graphql' ? { data: json, errors: [{ message: 'denied' }] } : json,
        }),
      }),
    ).rejects.toThrow('partial/error');
  });
  test('repeated pagination cursors fail instead of silently truncating', async () => {
    await expect(
      readCodeRabbitSnapshot({
        pr: '436',
        query: transport({
          modify: (args, json) =>
            args.includes('cursor=next')
              ? {
                  data: {
                    repository: {
                      pullRequest: {
                        reviewThreads: {
                          totalCount: 101,
                          nodes: [rootThread('x')],
                          pageInfo: { hasNextPage: true, endCursor: 'next' },
                        },
                      },
                    },
                  },
                }
              : json,
        }),
      }),
    ).rejects.toThrow('did not advance');
  });
  test('head/draft changes during pagination reject mixed evidence', async () => {
    let reads = 0;
    await expect(
      readCodeRabbitSnapshot({
        pr: '436',
        query: transport({
          modify: (args, json) =>
            args[0] === 'pr' && ++reads === 2
              ? { ...metadata(), headRefOid: OLD_REVIEW_HEAD }
              : json,
        }),
      }),
    ).rejects.toThrow('changed while reading');
  });
  test('bad SHA, timestamp or thread disposition fails closed', async () => {
    await expect(
      readCodeRabbitSnapshot({
        pr: '436',
        query: transport({
          modify: (args, json) =>
            args[0] === 'pr' ? { ...metadata(), headRefOid: 'short' } : json,
        }),
      }),
    ).rejects.toThrow('invalid head');
  });
  test.each([
    { totalCount: 102, nodes: [rootThread('second-0')], error: 'total changed' },
    { totalCount: 101, nodes: [], error: 'incomplete' },
    { totalCount: 101, nodes: [rootThread('first-0')], error: 'duplicated' },
  ])(
    'rejects truncated, duplicated or inconsistent connection totals %#',
    async ({ totalCount, nodes, error }) => {
      await expect(
        readCodeRabbitSnapshot({
          pr: '436',
          query: transport({
            modify: (args, json) =>
              args.includes('cursor=next')
                ? {
                    data: {
                      repository: {
                        pullRequest: {
                          reviewThreads: {
                            totalCount,
                            nodes,
                            pageInfo: { hasNextPage: false, endCursor: null },
                          },
                        },
                      },
                    },
                  }
                : json,
          }),
        }),
      ).rejects.toThrow(error);
    },
  );
  test('pre-cancelled and expired readers issue no GitHub requests', async () => {
    let calls = 0;
    const query: ReviewQuery = async () => {
      calls++;
      return { success: false, text: 'unused' };
    };
    await expect(
      readCodeRabbitSnapshot({ pr: '436', query, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    await expect(
      readCodeRabbitSnapshot({ pr: '436', query, deadline: Date.now() - 1 }),
    ).rejects.toThrow('deadline');
    expect(calls).toBe(0);
  });
});
