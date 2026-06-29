// apps/e2e/src/visual/core/report.ts
// Static HTML report generation for visual test results.
//
// Generates a self-contained `report.html` file in
// test-results/visual/ that displays each test case with
// its screenshot, evaluation prompt, JSON output, and
// pass/fail status in a responsive grid layout.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CaptureResult } from './capture';
import type { EvaluateResult } from './evaluate';

// ── Types ─────────────────────────────────────────────────────

/** Combined capture + evaluation result for a single test case. */
export type ReportEntry = {
  /** Case name. */
  name: string;
  /** File path of the screenshot (relative to report.html). */
  screenshotPath: string;
  /** The evaluation prompt used. */
  prompt: string;
  /** Whether the evaluation passed. */
  passed: boolean;
  /** Error message if capture or evaluation failed. */
  error?: string;
  /** Parsed AI result as JSON string. */
  resultJson?: string;
  /** AI score (0-100). */
  score?: number;
  /** Whether the result came from cache. */
  fromCache: boolean;
};

/** Summary statistics for the report header. */
export type ReportSummary = {
  total: number;
  passed: number;
  failed: number;
  cached: number;
  captureErrors: number;
  averageScore: number;
};

// ── Path resolution ──────────────────────────────────────────

const E2E_DIR = resolve(import.meta.dirname, '../../../..');
const REPORT_DIR = resolve(E2E_DIR, 'test-results', 'visual');
// ── HTML generation ──────────────────────────────────────────

/**
 * Escapes HTML entities to prevent XSS in report content.
 */
const _escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Renders the summary bar at the top of the report.
 */
const _renderSummary = (summary: ReportSummary): string => {
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  const overallLabel =
    passRate === 100 ? '✅ ALL PASSED' : passRate > 0 ? '⚠️ PARTIAL' : '❌ ALL FAILED';

  return `
    <div class="summary">
      <div class="summary-header">
        <h1>Aikami Visual Test Report</h1>
        <span class="overall ${passRate === 100 ? 'pass' : 'fail'}">${overallLabel}</span>
      </div>
      <div class="summary-stats">
        <div class="stat">
          <span class="stat-value">${summary.total}</span>
          <span class="stat-label">Total</span>
        </div>
        <div class="stat">
          <span class="stat-value pass">${summary.passed}</span>
          <span class="stat-label">Passed</span>
        </div>
        <div class="stat">
          <span class="stat-value fail">${summary.failed}</span>
          <span class="stat-label">Failed</span>
        </div>
        <div class="stat">
          <span class="stat-value cached">${summary.cached}</span>
          <span class="stat-label">Cached</span>
        </div>
        <div class="stat">
          <span class="stat-value">${summary.averageScore}</span>
          <span class="stat-label">Avg Score</span>
        </div>
      </div>
      <div class="timestamp">Generated: ${new Date().toISOString()}</div>
    </div>
  `;
};

/**
 * Renders a single test case card in the report grid.
 */
const _renderEntry = (entry: ReportEntry): string => {
  const statusClass = entry.passed ? 'pass' : 'fail';
  const statusLabel = entry.passed ? '✅ PASS' : '❌ FAIL';
  const cacheBadge = entry.fromCache ? '<span class="cache-badge">📦 Cached</span>' : '';

  return `
    <div class="card ${statusClass}">
      <div class="card-header">
        <h3>${_escapeHtml(entry.name)}</h3>
        <span class="status ${statusClass}">${statusLabel} ${cacheBadge}</span>
      </div>
      ${entry.error ? `<div class="card-error">❌ ${_escapeHtml(entry.error)}</div>` : ''}
      <div class="card-body">
        <div class="card-screenshot">
          ${entry.screenshotPath ? `<img src="${_escapeHtml(entry.screenshotPath)}" alt="${_escapeHtml(entry.name)} screenshot" />` : '<div class="no-screenshot">No screenshot</div>'}
        </div>
        <div class="card-details">
          <div class="detail-section">
            <h4>Prompt</h4>
            <pre>${_escapeHtml(entry.prompt)}</pre>
          </div>
          <div class="detail-section">
            <h4>Result</h4>
            ${entry.score !== undefined ? `<div class="score">Score: <strong>${entry.score}</strong>/100</div>` : ''}
            ${entry.resultJson ? `<pre>${_escapeHtml(entry.resultJson)}</pre>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
};

/**
 * Renders the CSS stylesheet for the report.
 */
const _renderStyles = (): string => {
  return `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        padding: 24px;
      }
      .summary {
        background: #1e293b;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
        border: 1px solid #334155;
      }
      .summary-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .summary-header h1 { font-size: 1.5rem; font-weight: 700; }
      .overall {
        padding: 6px 16px;
        border-radius: 8px;
        font-weight: 700;
        font-size: 0.9rem;
      }
      .overall.pass { background: #166534; color: #86efac; }
      .overall.fail { background: #7f1d1d; color: #fca5a5; }
      .summary-stats {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
      }
      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .stat-value { font-size: 1.5rem; font-weight: 700; }
      .stat-value.pass { color: #86efac; }
      .stat-value.fail { color: #fca5a5; }
      .stat-value.cached { color: #93c5fd; }
      .stat-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
      .timestamp { margin-top: 12px; font-size: 0.75rem; color: #64748b; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
        gap: 16px;
      }
      .card {
        background: #1e293b;
        border-radius: 12px;
        border: 1px solid #334155;
        overflow: hidden;
      }
      .card.pass { border-color: #166534; }
      .card.fail { border-color: #7f1d1d; }
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: #0f172a;
        border-bottom: 1px solid #334155;
      }
      .card-header h3 { font-size: 0.95rem; font-weight: 600; }
      .status {
        padding: 2px 10px;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .status.pass { background: #166534; color: #86efac; }
      .status.fail { background: #7f1d1d; color: #fca5a5; }
      .cache-badge { font-size: 0.7rem; opacity: 0.8; }
      .card-error {
        padding: 12px 16px;
        background: #450a0a;
        color: #fca5a5;
        font-size: 0.85rem;
        white-space: pre-wrap;
        font-family: monospace;
      }
      .card-body { padding: 16px; }
      .card-screenshot {
        margin-bottom: 12px;
        border-radius: 8px;
        overflow: hidden;
        background: #0f172a;
      }
      .card-screenshot img {
        width: 100%;
        display: block;
        image-rendering: pixelated;
      }
      .no-screenshot {
        padding: 48px 24px;
        text-align: center;
        color: #64748b;
        font-size: 0.85rem;
      }
      .card-details {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .detail-section h4 {
        font-size: 0.75rem;
        font-weight: 600;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 6px;
      }
      .detail-section pre {
        background: #0f172a;
        padding: 10px;
        border-radius: 6px;
        font-size: 0.8rem;
        color: #e2e8f0;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 200px;
        overflow-y: auto;
      }
      .score { font-size: 0.9rem; color: #93c5fd; margin-bottom: 6px; }
    </style>
  `;
};

// ── Public API ────────────────────────────────────────────────

/**
 * Computes summary statistics from a list of report entries.
 */
export const computeSummary = (entries: ReportEntry[]): ReportSummary => {
  let passed = 0;
  let failed = 0;
  let cached = 0;
  let captureErrors = 0;
  let totalScore = 0;
  let scoreCount = 0;

  for (const entry of entries) {
    if (entry.passed) {
      passed++;
    } else {
      failed++;
    }

    if (entry.fromCache) {
      cached++;
    }

    if (entry.error && !entry.resultJson) {
      captureErrors++;
    }

    if (entry.score !== undefined) {
      totalScore += entry.score;
      scoreCount++;
    }
  }

  return {
    total: entries.length,
    passed,
    failed,
    cached,
    captureErrors,
    averageScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
  };
};

/**
 * Generates a static HTML report and writes it to disk.
 *
 * @param entries - Combined capture + evaluation results.
 * @param outputDir - Output directory. Defaults to test-results/visual/.
 * @returns The full path to the generated report.html.
 */
export const generateReport = (options: { entries: ReportEntry[]; outputDir?: string }): string => {
  const { entries, outputDir = REPORT_DIR } = options;

  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'report.html');

  const summary = computeSummary(entries);

  const cards = entries.map((e) => _renderEntry(e)).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aikami Visual Test Report</title>
  ${_renderStyles()}
</head>
<body>
  ${_renderSummary(summary)}
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;

  writeFileSync(outputPath, html);
  return outputPath;
};

/**
 * Builds a report entry from a capture result and its corresponding
 * evaluation result.
 */
export const buildReportEntry = (options: {
  capture: CaptureResult;
  evaluate: EvaluateResult;
}): ReportEntry => {
  const { capture, evaluate } = options;

  return {
    name: capture.name,
    screenshotPath: capture.filepath ? (capture.filepath.split('/').pop() ?? capture.filepath) : '',
    prompt: capture.prompt,
    passed: evaluate.passed && !capture.error,
    error: capture.error ?? evaluate.error,
    resultJson: evaluate.result ? JSON.stringify(evaluate.result, null, 2) : undefined,
    score: evaluate.score,
    fromCache: evaluate.fromCache,
  };
};
