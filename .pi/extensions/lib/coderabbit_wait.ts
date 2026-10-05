// .pi/extensions/lib/coderabbit_wait.ts

import { setTimeout as delay } from 'node:timers/promises';
import {
  type CodeRabbitLifecycle,
  type CodeRabbitSnapshot,
  codeRabbitFindings,
  codeRabbitLifecycle,
  codeRabbitRevision,
} from './coderabbit_evidence.ts';

/** Bounds callers as well as schema-free detached supervisor inputs. */
export const validateReviewWait = (options: { timeoutMs: number; intervalMs: number }): void => {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 3_600_000 ||
    !Number.isSafeInteger(options.intervalMs) ||
    options.intervalMs < 1 ||
    options.intervalMs > 60_000
  ) {
    throw new Error('Review wait requires a timeout of 1..3600000ms and interval of 1..60000ms');
  }
};

const readAvailableSnapshot = async (options: {
  readSnapshot: () => Promise<CodeRabbitSnapshot>;
  signal?: AbortSignal;
  report?: (line: string) => void;
}) => {
  try {
    return { snapshot: await options.readSnapshot(), error: undefined };
  } catch (error) {
    options.signal?.throwIfAborted();
    options.report?.(`GitHub evidence unavailable; retrying: ${String(error).slice(0, 300)}`);
    return { snapshot: undefined, error };
  }
};

const pinSnapshot = (options: { snapshot: CodeRabbitSnapshot; head?: string }): string => {
  if (options.snapshot.draft) {
    throw new Error('Draft PR cannot establish completed CodeRabbit review');
  }
  const head = options.head ?? options.snapshot.head;
  if (options.snapshot.head !== head) {
    throw new Error('PR head changed during CodeRabbit wait; restart for the new head');
  }
  return head;
};

const hasNewFindings = (options: {
  baseline?: Map<string, string>;
  actionable: Map<string, string>;
}): boolean => {
  const baseline = options.baseline;
  return (
    baseline !== undefined &&
    [...options.actionable].some(([id, version]) => baseline.get(id) !== version)
  );
};

const isCompletedSince = (options: { evidence: CodeRabbitLifecycle; since?: number }): boolean =>
  options.evidence.lifecycle === 'completed' &&
  (options.since === undefined || Date.parse(options.evidence.completedAt ?? '') >= options.since);

/** Watch edits and actionable thread revisions without treating human chatter as findings. */
export const waitForCodeRabbit = async (options: {
  readSnapshot: () => Promise<CodeRabbitSnapshot>;
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
  head?: string;
  since?: number;
  returnOnFindings?: boolean;
  report?: (line: string) => void;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}) => {
  validateReviewWait(options);
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => delay(milliseconds, undefined, { signal: options.signal }));
  let pinnedHead = options.head;
  let revision: string | undefined;
  let baselineFindings: Map<string, string> | undefined;
  let latest: CodeRabbitSnapshot | undefined;
  let lastError: unknown;
  while (now() < deadline) {
    options.signal?.throwIfAborted();
    const read = await readAvailableSnapshot(options);
    const snapshot = read.snapshot;
    if (!snapshot) {
      lastError = read.error;
      await sleep(Math.max(0, Math.min(options.intervalMs, deadline - now())));
      continue;
    }
    options.signal?.throwIfAborted();
    if (now() >= deadline) {
      break;
    }
    pinnedHead = pinSnapshot({ snapshot, head: pinnedHead });
    latest = snapshot;
    lastError = undefined;
    const evidence = codeRabbitLifecycle(snapshot);
    const findings = codeRabbitFindings(snapshot);
    const currentRevision = codeRabbitRevision(snapshot);
    if (currentRevision !== revision) {
      options.report?.(
        `CodeRabbit ${evidence.lifecycle} on ${snapshot.head.slice(0, 8)}; ${findings.actionableCount} current, ${findings.historicalCount} historical unresolved findings`,
      );
      revision = currentRevision;
    }
    if (isCompletedSince({ evidence, since: options.since })) {
      return { snapshot, evidence, findings, reason: 'completed' as const };
    }
    const actionable = new Map(
      findings.findings
        .filter((finding) => finding.disposition === 'current')
        .map((finding) => [finding.id, JSON.stringify(finding)]),
    );
    if (options.returnOnFindings && hasNewFindings({ baseline: baselineFindings, actionable })) {
      return { snapshot, evidence, findings, reason: 'findings' as const };
    }
    baselineFindings ??= actionable;
    await sleep(Math.max(0, Math.min(options.intervalMs, deadline - now())));
  }
  options.signal?.throwIfAborted();
  if (lastError) {
    throw new Error(
      `Timed out with unavailable CodeRabbit evidence: ${String(lastError).slice(0, 300)}`,
    );
  }
  return { snapshot: latest, reason: 'timeout' as const };
};
