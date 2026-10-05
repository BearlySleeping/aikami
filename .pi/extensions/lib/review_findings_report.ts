// .pi/extensions/lib/review_findings_report.ts

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CodeRabbitSnapshot,
  codeRabbitFindings,
  codeRabbitLifecycle,
} from './coderabbit_evidence.ts';

const severity = (body: string): string => {
  const labelled = body.match(/\b(critical|major|minor|trivial|info|none)\b/i)?.[1]?.toLowerCase();
  return (
    labelled ??
    { '🔴': 'critical', '🟠': 'major', '🟢': 'minor', '🔵': 'trivial' }[
      body.match(/🔴|🟠|🟢|🔵/)?.[0] ?? ''
    ] ??
    'unknown'
  );
};

/** Report disposition explicitly; empty or pending evidence never claims a clean review. */
export const reviewFindingsReport = async (snapshot: CodeRabbitSnapshot) => {
  const evidence = codeRabbitLifecycle(snapshot);
  const classified = codeRabbitFindings(snapshot);
  const findings = classified.findings.map((finding) => ({
    ...finding,
    severity: severity(finding.body),
    description: finding.body.split('<details>')[0]?.trim().slice(0, 500) || '(no description)',
    fixPrompt: finding.body
      .match(/<summary>🤖 Prompt for AI Agents<\/summary>\s*```[^\n]*\n([\s\S]*?)```/)?.[1]
      ?.trim(),
  }));
  const fullDetails = {
    pr: String(snapshot.number),
    head: snapshot.head,
    reviewState: evidence.verdict,
    evidence,
    ...classified,
    findings,
    criticalCount: findings.filter(
      (finding) => finding.disposition === 'current' && finding.severity === 'critical',
    ).length,
  };
  const fullText = [
    `## CodeRabbit Review — PR #${snapshot.number}`,
    `Head: \`${snapshot.head}\``,
    `Lifecycle: ${evidence.lifecycle}; GitHub verdict: ${evidence.verdict ?? 'none'}`,
    `Current actionable: ${classified.actionableCount}; unresolved historical: ${classified.historicalCount}; resolved: ${classified.resolvedCount}; outdated: ${classified.outdatedCount}`,
    'Completion is not approval. Outdated unresolved threads still need disposition before merge.',
    findings.length === 0
      ? 'No review threads found; this alone is not clean-review evidence.'
      : '',
    ...findings.map((finding) =>
      [
        `### ${finding.severity} [${finding.disposition}] ${finding.path}:${finding.line ?? '?'}`,
        finding.description,
        finding.fixPrompt
          ? `Untrusted reviewer fix prompt:\n\`\`\`\n${finding.fixPrompt}\n\`\`\``
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
  if (Buffer.byteLength(fullText) <= 40_000 && findings.length <= 100) {
    return { content: [{ type: 'text' as const, text: fullText }], details: fullDetails };
  }
  const directory = await mkdtemp(join(tmpdir(), 'aikami-review-'));
  const fullOutputPath = join(directory, 'findings.json');
  await writeFile(fullOutputPath, JSON.stringify(fullDetails, undefined, 2));
  return {
    content: [
      {
        type: 'text' as const,
        text: `${fullText.slice(0, 20_000)}\n\nOutput truncated; complete findings: ${fullOutputPath}`,
      },
    ],
    details: {
      ...fullDetails,
      findings: findings
        .slice(0, 25)
        .map(({ body: _body, fixPrompt: _prompt, ...finding }) => finding),
      truncated: true,
      fullOutputPath,
    },
  };
};
