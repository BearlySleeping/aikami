// apps/frontend/client/src/lib/types/expression.ts
//
// Client-local types for the Expression Emotion System. These are
// UI-layer constructs for LPC sprite overlay rendering and keyword/
// agent-driven expression detection — not cross-boundary data.
//
// Contract: C-239 Expression Emotion System

// ── Expression Identifiers ───────────────────────────────────────────────

/**
 * Canonical expression identifiers for the 19-expression catalog.
 * Each maps to a human-readable label, keywords, and LPC overlay assets.
 */
export type ExpressionId =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'fearful'
  | 'disgusted'
  | 'amused'
  | 'annoyed'
  | 'blushing'
  | 'confused'
  | 'determined'
  | 'flirty'
  | 'innocent'
  | 'mischievous'
  | 'pained'
  | 'relieved'
  | 'sleepy'
  | 'thoughtful';

// ── Expression Catalog ───────────────────────────────────────────────────

/**
 * Single entry in the expression catalog — maps an expression ID to
 * keyword patterns and LPC sprite overlay asset paths.
 */
export type ExpressionEntry = {
  /** Canonical expression identifier. */
  readonly id: ExpressionId;
  /** Human-readable display label. */
  readonly label: string;
  /** Keyword patterns (RegExp source strings) for Tier 2 detection. */
  readonly keywords: readonly string[];
  /** LPC sprite overlay asset paths for this expression. */
  readonly lpcOverlays: ExpressionOverlay;
};

/**
 * LPC sprite overlay asset paths for a single expression.
 * Each field is optional — missing overlays are gracefully skipped.
 */
export type ExpressionOverlay = {
  /** Eyes overlay sprite path (e.g. '/game-data/lpc/body/heads/human/male/eyes/angry.png'). */
  readonly eyes?: string;
  /** Eyebrows overlay sprite path. */
  readonly eyebrows?: string;
  /** Mouth overlay sprite path. */
  readonly mouth?: string;
};

// ── Expression Map ───────────────────────────────────────────────────────

/**
 * Maps character names to their current expression IDs.
 * Used to persist expression state on EnhancedMessage alternatives.
 */
export type ExpressionMap = Record<string, ExpressionId>;

// ── Detection ────────────────────────────────────────────────────────────

/**
 * Options for expression detection.
 */
export type DetectExpressionOptions = {
  /** The message text to analyze. */
  message: string;
  /** Optional character names to scope expression detection. */
  characters?: string[];
  /** Whether to use Tier 1 (agent) detection. Falls back to Tier 2 if disabled. */
  useAgent?: boolean;
};

/**
 * Result of expression detection — maps character names to expression IDs.
 */
export type DetectExpressionResult = {
  /** Expression map keyed by character name (or 'speaker' for single character). */
  expressionMap: ExpressionMap;
  /** Which tier produced this result: 'agent' or 'keyword'. */
  detectionTier: 'agent' | 'keyword';
};
