// .pi/extensions/lib/coderabbit_reader.ts

import {
  type CodeRabbitSnapshot,
  type CommentEvidence,
  isReviewRecord,
  type ReviewEvidence,
  type StatusEvidence,
  type ThreadEvidence,
} from './coderabbit_evidence.ts';

/** Transport seam shared by the interactive extension and detached supervisor. */
export type ReviewQuery = (
  args: string[],
  options: { signal?: AbortSignal; timeoutMs: number },
) => Promise<{
  success: boolean;
  text: string;
  json?: unknown;
}>;

const record = (value: unknown): Record<string, unknown> => {
  if (!isReviewRecord(value)) {
    throw new Error('Malformed GitHub review evidence: expected object');
  }
  return value;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('Malformed GitHub review evidence: expected string');
  }
  return value;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error('Malformed GitHub review evidence: expected boolean');
  }
  return value;
};
const date = (value: unknown): string => {
  const text = string(value);
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error('Malformed GitHub review evidence: invalid timestamp');
  }
  return text;
};
const head = (value: unknown): string => {
  const text = string(value);
  if (!/^[a-f0-9]{40}$/i.test(text)) {
    throw new Error('Malformed GitHub review evidence: invalid head SHA');
  }
  return text;
};
const login = (value: unknown): string => (value === null ? '' : string(record(value).login));

const parseReview = (value: unknown): ReviewEvidence => {
  const item = record(value);
  const state = string(item.state);
  return {
    id: string(item.id),
    login: login(item.author),
    head: item.commit === null && state === 'PENDING' ? '' : head(record(item.commit).oid),
    state,
    body: string(item.body),
    submittedAt: item.submittedAt === null ? undefined : date(item.submittedAt),
  };
};
const parseComment = (value: unknown): CommentEvidence => {
  const item = record(value);
  return {
    id: string(item.id),
    login: login(item.author),
    body: string(item.body),
    createdAt: date(item.createdAt),
    updatedAt: date(item.updatedAt),
  };
};
const threadLine = (value: unknown): number | undefined => {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Malformed GitHub review evidence: invalid thread line');
  }
  return value;
};

const parseThread = (value: unknown): ThreadEvidence => {
  const item = record(value);
  const comments = record(item.comments);
  if (!Array.isArray(comments.nodes) || comments.nodes.length !== 1) {
    throw new Error('Malformed GitHub review evidence: missing thread root');
  }
  const root = record(comments.nodes[0]);
  const review = root.pullRequestReview === null ? undefined : record(root.pullRequestReview);
  return {
    id: string(item.id),
    resolved: boolean(item.isResolved),
    outdated: boolean(item.isOutdated),
    login: login(root.author),
    body: string(root.body),
    path: string(root.path),
    line: threadLine(root.line),
    // Incremental comments may attach to an older formal review. The root's
    // immutable original commit, not its parent's review commit, owns provenance.
    head: head(record(root.originalCommit ?? review?.commit).oid),
    updatedAt: date(root.updatedAt),
  };
};
const parseStatus = (value: unknown): StatusEvidence => {
  const item = record(value);
  if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id)) {
    throw new Error('Malformed GitHub review evidence: invalid status ID');
  }
  return {
    id: item.id,
    login: login(item.creator),
    context: string(item.context),
    state: string(item.state),
    description: item.description === null ? '' : string(item.description),
    updatedAt: date(item.updated_at),
  };
};

const selections = {
  reviews: 'id author { login } commit { oid } state body submittedAt',
  comments: 'id author { login } body createdAt updatedAt',
  reviewThreads: `id isResolved isOutdated comments(first: 1) { nodes {
    author { login } body path line updatedAt originalCommit { oid } pullRequestReview { commit { oid } }
  } }`,
} as const;

/** Preserve repository identity for URLs and reject option-shaped or invalid selectors. */
export const validateReviewSelector = (value: string): string => {
  const selector = value.trim();
  if (
    !selector ||
    selector.startsWith('-') ||
    /\s/.test(selector) ||
    (selector.includes('://') &&
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(selector))
  ) {
    throw new Error('Invalid CodeRabbit PR selector');
  }
  return selector;
};

/** Base-repository identity must survive every subsequent PR operation, including fork PRs. */
export const reviewPrSelector = (snapshot: CodeRabbitSnapshot): string =>
  `https://github.com/${snapshot.repository}/pull/${snapshot.number}`;

const parseConnectionPage = (options: { value: unknown; name: keyof typeof selections }) => {
  const response = record(options.value);
  if (response.errors !== undefined) {
    throw new Error('GitHub GraphQL returned partial/error review evidence');
  }
  const pullRequest = record(record(record(response.data).repository).pullRequest);
  const result = record(pullRequest[options.name]);
  if (!Array.isArray(result.nodes)) {
    throw new Error('Malformed GitHub review evidence: missing connection nodes');
  }
  if (
    typeof result.totalCount !== 'number' ||
    !Number.isSafeInteger(result.totalCount) ||
    result.totalCount < 0
  ) {
    throw new Error('Malformed GitHub review evidence: missing connection total');
  }
  const nodes: unknown[] = result.nodes;
  const pageInfo = record(result.pageInfo);
  return {
    nodes,
    total: result.totalCount,
    hasNextPage: boolean(pageInfo.hasNextPage),
    endCursor: pageInfo.endCursor,
  };
};

type ConnectionAccumulator = { nodes: unknown[]; ids: Set<string>; total?: number };

const appendConnectionPage = (options: {
  accumulated: ConnectionAccumulator;
  page: ReturnType<typeof parseConnectionPage>;
}): void => {
  const { accumulated, page } = options;
  accumulated.total ??= page.total;
  if (accumulated.total !== page.total) {
    throw new Error('GitHub review evidence total changed during pagination; retry');
  }
  for (const node of page.nodes) {
    const id = string(record(node).id);
    if (!id || accumulated.ids.has(id)) {
      throw new Error('GitHub review evidence contains missing or duplicated node IDs');
    }
    accumulated.ids.add(id);
    accumulated.nodes.push(node);
  }
};

const completeConnection = (accumulated: ConnectionAccumulator): unknown[] => {
  if (accumulated.total !== accumulated.nodes.length) {
    throw new Error('GitHub review evidence pagination incomplete; findings are unknown');
  }
  return accumulated.nodes;
};

/** Read complete, validated evidence from the base repository, with a head recheck after pagination. */
export const readCodeRabbitSnapshot = async (options: {
  pr: string;
  query: ReviewQuery;
  signal?: AbortSignal;
  deadline?: number;
}): Promise<CodeRabbitSnapshot> => {
  const deadline = Math.min(options.deadline ?? Number.POSITIVE_INFINITY, Date.now() + 60_000);
  const query = async (args: string[]): Promise<unknown> => {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new Error('GitHub review evidence deadline exceeded');
    }
    const result = await options.query(args, {
      signal: options.signal,
      timeoutMs: Math.min(60_000, Math.max(1, deadline - Date.now())),
    });
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new Error('GitHub review evidence deadline exceeded');
    }
    if (!result.success || result.json === undefined) {
      throw new Error(
        `Cannot read GitHub review evidence: ${result.text.slice(0, 300) || 'missing JSON'}`,
      );
    }
    return result.json;
  };
  const metadataArgs = [
    'pr',
    'view',
    validateReviewSelector(options.pr),
    '--json',
    'number,url,headRefOid,headRefName,isDraft',
  ];
  const metadata = record(await query(metadataArgs));
  const url = string(metadata.url).match(
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/,
  );
  if (!url?.[1] || !url[2] || !url[3] || Number(url[3]) !== metadata.number) {
    throw new Error('Malformed GitHub review evidence: invalid base repository URL');
  }
  const owner = url[1];
  const repository = url[2];
  const number = Number(url[3]);
  const pinnedHead = head(metadata.headRefOid);
  const branch = string(metadata.headRefName);
  const draft = boolean(metadata.isDraft);

  const connection = async (name: keyof typeof selections): Promise<unknown[]> => {
    const accumulated: ConnectionAccumulator = { nodes: [], ids: new Set() };
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const args = [
        'api',
        'graphql',
        '-f',
        `query=query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
          ${name}(first: 100, after: $cursor) { totalCount nodes { ${selections[name]} } pageInfo { hasNextPage endCursor } }
        } }
      }`,
        '-f',
        `owner=${owner}`,
        '-f',
        `repo=${repository}`,
        '-F',
        `number=${number}`,
      ];
      if (cursor) {
        args.push('-f', `cursor=${cursor}`);
      }
      const result = parseConnectionPage({ value: await query(args), name });
      appendConnectionPage({ accumulated, page: result });
      if (!result.hasNextPage) {
        return completeConnection(accumulated);
      }
      cursor = string(result.endCursor);
      if (!cursor || seen.has(cursor)) {
        throw new Error('GitHub review evidence pagination did not advance');
      }
      seen.add(cursor);
    }
    throw new Error('GitHub review evidence pagination limit exceeded; findings are incomplete');
  };

  const [reviews, comments, threads, rawStatuses] = await Promise.all([
    connection('reviews'),
    connection('comments'),
    connection('reviewThreads'),
    query([
      'api',
      `repos/${owner}/${repository}/commits/${pinnedHead}/statuses?per_page=100`,
      '--paginate',
      '--slurp',
    ]),
  ]);
  if (!Array.isArray(rawStatuses) || !rawStatuses.every(Array.isArray)) {
    throw new Error('Malformed GitHub review evidence: invalid paginated statuses');
  }
  const recheck = record(await query(metadataArgs));
  if (recheck.headRefOid !== pinnedHead || recheck.isDraft !== draft) {
    throw new Error(
      'PR head or draft state changed while reading CodeRabbit evidence; retry on the new head',
    );
  }
  return {
    number,
    repository: `${owner}/${repository}`,
    head: pinnedHead,
    branch,
    draft,
    reviews: reviews.map(parseReview),
    comments: comments.map(parseComment),
    threads: threads.map(parseThread),
    statuses: rawStatuses.flat().map(parseStatus),
  };
};
