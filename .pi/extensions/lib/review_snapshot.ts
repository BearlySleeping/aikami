// .pi/extensions/lib/review_snapshot.ts

import { type CodeRabbitSnapshot, codeRabbitLifecycle } from './coderabbit_evidence.ts';
import { readCodeRabbitSnapshot } from './coderabbit_reader.ts';
import { runGh } from './gh.ts';

/** Use the same validated paginated reader as the detached supervisor. */
export const readReviewSnapshot = (options: {
  pr: string;
  signal?: AbortSignal;
  deadline?: number;
}) =>
  readCodeRabbitSnapshot({
    ...options,
    query: (args, request) => runGh(args, { ...request, parseJson: true }),
  });

/** Compatibility state: provider completion is COMPLETED, never fabricated approval. */
export const reviewSnapshotState = (snapshot: CodeRabbitSnapshot): string => {
  const evidence = codeRabbitLifecycle(snapshot);
  if (evidence.lifecycle === 'skipped' || evidence.lifecycle === 'failed') {
    throw new Error(
      `CodeRabbit review ${evidence.lifecycle}; inspect eligibility/provider errors before retrying`,
    );
  }
  return evidence.lifecycle === 'completed' ? (evidence.verdict ?? 'COMPLETED') : '';
};
