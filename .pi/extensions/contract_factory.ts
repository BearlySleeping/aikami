// .pi/extensions/contract_factory.ts
/**
 * Contract Factory Pi Extension (V2).
 *
 * Uses the canonical backlog parser (scripts/src/lib/ops/parse_backlog.ts)
 * as the single source of truth. Generates draft contracts using
 * docs/contracts/TEMPLATE.md — never embeds a template copy.
 *
 * Tools:
 *   contract_scan_backlog  — Scan docs/TODO.md for available items
 *   contract_generate       — Generate a draft contract shell from a backlog item
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Inline parser (avoids cross-process import of parse_backlog.ts) ─

type BacklogItem = {
  id: string;
  title: string;
  phase: string;
  status: string;
  priority: string;
  target: string;
  outcome: string;
  scope: string;
  dependencies: string;
  acceptanceGate: string;
  references: string;
  alreadyGenerated: boolean;
  existingContractPath: string | null;
  promotion: string | null;
};

const TODO_PATH = 'docs/TODO.md';
const CONTRACTS_DIR = 'docs/contracts';

const _parseBacklog = (repoRoot: string): { items: BacklogItem[]; errors: string[] } => {
  const todoPath = join(repoRoot, TODO_PATH);
  const contractsDir = join(repoRoot, CONTRACTS_DIR);
  const errors: string[] = [];
  const items: BacklogItem[] = [];

  if (!existsSync(todoPath)) {
    errors.push(`Backlog file not found: ${todoPath}`);
    return { items, errors };
  }

  const content = readFileSync(todoPath, 'utf-8');
  const sections = content.split(/^(?=(?:## |# Phase ))/m);
  let currentPhase = '';

  for (const section of sections) {
    const lines = section.split('\n');

    if (lines[0]?.startsWith('## ') || /^#\s+Phase\s+\d/.test(lines[0] ?? '')) {
      currentPhase = (lines[0] ?? '').replace(/^#{1,2}\s+/, '').trim();
    }

    let currentItemLines: string[] = [];
    let currentId = '';
    let currentTitle = '';
    let inItem = false;

    for (const line of lines) {
      const headingMatch = line.match(/^###\s+(C-\d+|MIG-\d+)\s+[–—-]\s+(.+)/);
      if (headingMatch) {
        if (inItem && currentId) {
          items.push(
            _buildItem(currentId, currentTitle, currentPhase, currentItemLines, contractsDir),
          );
        }
        currentId = headingMatch[1] ?? '';
        currentTitle = (headingMatch[2] ?? '').trim();
        currentItemLines = [];
        inItem = true;
        continue;
      }
      if (inItem) {
        currentItemLines.push(line);
      }
    }

    if (inItem && currentId) {
      items.push(_buildItem(currentId, currentTitle, currentPhase, currentItemLines, contractsDir));
    }
  }

  return { items, errors };
};

const _extractPromotionFromContract = (contractPath: string): string | null => {
  try {
    const content = readFileSync(contractPath, 'utf8');
    const match = content.match(/\|\s*\*\*Promotion\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
    if (match) {
      const raw = (match[1] ?? '').trim();
      if (raw && raw !== '—') {
        return raw;
      }
    }
  } catch {
    // ignore
  }
  return null;
};

const _buildItem = (
  id: string,
  title: string,
  phase: string,
  lines: string[],
  contractsDir: string,
): BacklogItem => {
  const rawFields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^-\s+\*\*(.+?):\*\*\s*(.+)/);
    if (match) {
      rawFields[(match[1] ?? '').trim()] = (match[2] ?? '').trim();
    }
  }
  const get = (fieldName: string): string => rawFields[fieldName] ?? '';

  // Find existing contract by ID prefix
  let existingContractPath: string | null = null;
  try {
    const files = readdirSync(contractsDir);
    const match = files.find(
      (f) => f.startsWith(`${id}-`) && f.endsWith('.md') && f !== 'TEMPLATE.md',
    );
    existingContractPath = match ? join(contractsDir, match) : null;
  } catch {
    existingContractPath = null;
  }

  // Extract promotion from existing contract
  const promotion = existingContractPath
    ? _extractPromotionFromContract(existingContractPath)
    : null;

  return {
    id,
    title,
    phase,
    status: get('Status') || 'not_started',
    priority: get('Priority') || 'P2',
    target: get('Target'),
    outcome: get('Outcome'),
    scope: get('Scope'),
    dependencies: get('Dependencies'),
    acceptanceGate: get('Acceptance gate'),
    references: get('References'),
    alreadyGenerated: existingContractPath !== null,
    existingContractPath,
    promotion,
  };
};

// ── Template loader (reads TEMPLATE.md at runtime) ─────────

const _loadTemplate = (cwd: string): string => {
  const templatePath = resolve(cwd, CONTRACTS_DIR, 'TEMPLATE.md');
  if (existsSync(templatePath)) {
    return readFileSync(templatePath, 'utf-8');
  }
  return [
    '# Contract {FEATURE_CODE}: {TITLE}',
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **Source** | TODO.md |',
    '| **Target** | TBD |',
    '| **Priority** | TBD |',
    '| **Dependencies** | TBD |',
    '| **Status** | draft |',
    '| **Contract version** | 2.0.0 |',
    '',
    '## Overview',
    '',
    'TBD',
    '',
    '<!-- Generated by contract_factory (fallback — TEMPLATE.md not found) -->',
  ].join('\n');
};

// ── File name builder ──────────────────────────────────────

const _buildFileName = (id: string, title: string): string => {
  const key = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
  return `${id}-${key}.md`;
};

// ── Extension registration ─────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ─────────────────────────────────────────────────────────┐
  // Tool 1: contract_scan_backlog                           │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_scan_backlog',
    label: 'Contract: Scan Backlog',
    description:
      'Scan docs/TODO.md for available backlog items. Shows stable IDs (C-312), titles, priorities, and whether a contract already exists.',
    promptSnippet: 'Use contract_scan_backlog to see what TODO items need contracts.',
    promptGuidelines: [
      'Use this to discover pending items before generating contracts.',
      'Items with existing contracts are marked with file paths.',
      'Use the stable ID from this output with contract_generate.',
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { items, errors } = _parseBacklog(ctx.cwd);

      if (items.length === 0) {
        const msg =
          errors.length > 0
            ? `Backlog parse errors:\n${errors.map((e) => `- ${e}`).join('\n')}`
            : 'No items found in docs/TODO.md.';
        return { content: [{ type: 'text', text: msg }], details: {} };
      }

      const pending = items.filter((i) => !i.alreadyGenerated && i.status !== 'completed');
      const existing = items.filter((i) => i.alreadyGenerated);

      const lines = [`**docs/TODO.md Backlog Scan** (${items.length} items)\n`];

      if (pending.length > 0) {
        lines.push(`### Pending (${pending.length})\n`);
        for (const item of pending) {
          lines.push(`🔴 \`${item.id}\` — **${item.title}** (${item.priority}, ${item.phase})`);
        }
      }

      const PromotionIcons: Record<string, string> = {
        sandbox: '🧪',
        integrated: '🔗',
        // biome-ignore lint/style/useNamingConvention: matches promotion state key
        release_verified: '🚀',
      };

      if (existing.length > 0) {
        lines.push(`\n### Already Generated (${existing.length})\n`);
        for (const item of existing) {
          const promoIcon = item.promotion ? (PromotionIcons[item.promotion] ?? '') : '';
          const promoStr = item.promotion ? ` [${promoIcon} ${item.promotion}]` : ' [—]';
          lines.push(`✅ \`${item.id}\` — ${item.title}${promoStr}`);
        }
      }

      lines.push(`\nGenerate: \`contract_generate\` with the ID (e.g. \`C-312\`).`);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { pendingCount: pending.length, existingCount: existing.length },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 2: contract_generate                               │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_generate',
    label: 'Contract: Generate from Backlog',
    description:
      'Generate a draft contract shell from a docs/TODO.md item. ' +
      'Uses docs/contracts/TEMPLATE.md as the canonical template — never an embedded copy. ' +
      'Fills known fields from the backlog; marks unknowns as TBD. ' +
      'Use contract_scan_backlog first to discover available IDs.',
    promptSnippet: 'Use contract_generate to create a draft contract from a TODO.md item.',
    promptGuidelines: [
      'Run contract_scan_backlog first to find the ID.',
      'If the contract already exists, it will NOT be overwritten.',
      'Generated contracts are DRAFT shells — the Contract Writer completes them.',
      'Uses TEMPLATE.md v2.0.0 for the contract structure.',
    ],
    parameters: Type.Object({
      featureCode: Type.String({
        description:
          'Stable backlog ID from docs/TODO.md (e.g. "C-312"). Use contract_scan_backlog to discover available IDs.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const { items } = _parseBacklog(cwd);
      const item = items.find((i) => i.id === params.featureCode);

      if (!item) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `❌ ID \`${params.featureCode}\` not found in docs/TODO.md.`,
                '',
                `Run \`contract_scan_backlog\` to see available IDs.`,
                `If this is a raw request (not from TODO.md), use the /contract-create prompt instead.`,
              ].join('\n'),
            },
          ],
          isError: true,
          details: {},
        };
      }

      if (item.alreadyGenerated && item.existingContractPath) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `⚠️ Contract for \`${item.id}\` already exists.`,
                `File: \`${item.existingContractPath}\``,
                '',
                'Delete it first if you want to regenerate from scratch.',
                'Or edit the existing contract directly.',
              ].join('\n'),
            },
          ],
          details: { alreadyExists: true, filePath: item.existingContractPath },
        };
      }

      // Load the canonical template
      const template = _loadTemplate(cwd);

      // Extract clean single-line values from the backlog item.
      // Multi-line fields from TODO.md are truncated to first line.
      const firstLine = (text: string): string => (text ?? '').split('\n')[0]?.trim() ?? '';

      const priority = item.priority || 'P2';
      const priorityJustification = item.phase || '';
      const rawTarget = firstLine(item.target);
      const rawOutcome = firstLine(item.outcome);
      const rawDeps = item.dependencies || '—';

      // Step 1: Only substitute {FEATURE_CODE} and {TITLE} globally.
      // These appear in the H1 heading — no template hints use these exact tokens.
      let filled = template.replace(/\{FEATURE_CODE\}/g, item.id).replace(/\{TITLE\}/g, item.title);

      // Step 2: Rewrite Metadata table rows using structured markdown matching.
      // Replaces the ENTIRE row (including display hints like P{0|1|2|3})
      // with clean values from the backlog item. Avoids corrupting template
      // hint syntax that happens to use the same brace notation.
      const replaceRow = (label: string, value: string): void => {
        // Match the entire table row: pipe, bold label, pipe, cell content, ending pipe.
        // Use [^\n]* instead of [^|]* to handle escaped pipes inside the cell
        // (e.g. P{0\|1\|2\|3} in the template priority hint).
        filled = filled.replace(
          new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|[^\n]*\\|`),
          `| **${label}** | ${value} |`,
        );
      };

      replaceRow('Source', `TODO.md — ${item.phase}`);
      replaceRow('Target', `${rawTarget || 'TBD'} — TBD`);
      replaceRow('Priority', `${priority} — ${priorityJustification}`);
      replaceRow('Dependencies', rawDeps);
      replaceRow('Status', 'draft');
      replaceRow('Promotion', '—');
      replaceRow('Contract version', '2.0.0');
      replaceRow('Docs Impact', 'TBD');

      // Step 3: Fill Overview section with the item's outcome.
      filled = filled.replace(
        /\{2-4 sentences describing what this task is[^}]*\}/,
        rawOutcome || item.title,
      );

      // Step 4: Fill Problem & Baseline evidence marker with a brief placeholder.
      filled = filled.replace(
        /\{what is broken or missing today[^}]*\}/,
        `${item.title} — see TODO.md for details.`,
      );

      // All other {placeholders} remain — the linter catches them, the
      // Contract Writer fills them during /contract-create.

      // Build file path
      const fileName = _buildFileName(item.id, item.title);
      const contractsDir = resolve(cwd, CONTRACTS_DIR);

      if (!existsSync(contractsDir)) {
        mkdirSync(contractsDir, { recursive: true });
      }

      const filePath = resolve(contractsDir, fileName);
      writeFileSync(filePath, filled);

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Draft contract generated: \`${item.id}\``,
              `**${item.title}**`,
              `File: \`docs/contracts/${fileName}\``,
              `Priority: ${priority} | Status: draft | Template: v2.0.0`,
              '',
              `Next steps:`,
              `1. Use \`/contract-create\` to complete the draft with codebase inspection`,
              `2. Use \`/contract-critique\` for adversarial review`,
              `3. After approval, use \`/contract\` to implement`,
            ].join('\n'),
          },
        ],
        details: {
          featureCode: item.id,
          fileName,
          priority,
        },
      };
    },
  });
}
