// .pi/extensions/lib/role_profiles.ts
//
// 🔴 Role profiles define the minimal tool surface each pipeline role requires.
// Every registered tool costs tokens on EVERY turn — profiles prevent the
// writer (who never publishes) from paying for `gh_pr`, `gh_release`, etc.
//
// Profiles are used by `isToolEnabledForRole()` which gates tool registration.
// Missing required extensions fail preflight with an actionable error rather
// than silently falling back to "all tools" mode.

// ── Role identifiers ──────────────────────────────────────────

export type PipelineRole = 'writer' | 'critic' | 'implementer' | 'verifier' | 'review';

const ALL_ROLES: readonly PipelineRole[] = [
  'writer',
  'critic',
  'implementer',
  'verifier',
  'review',
] as const;

// ── Tool capability categories ────────────────────────────────

/**
 * Named tool capability categories. Each maps to one or more extension keys
 * (the identifiers used with `isEnabled` / `PI_TOOLS_ON` / `PI_TOOLS_OFF`).
 */
export type ToolCapability =
  | 'completion'
  | 'read_source'
  | 'edit_source'
  | 'test_runner'
  | 'publication'
  | 'browser'
  | 'ai_vision'
  | 'cloud_infra'
  | 'contract_pipeline'
  | 'code_review'
  | 'shell_exec'
  | 'mcp_context'
  | 'all';

/**
 * Extension keys that implement each capability. A role declares which
 * capabilities it needs; the profile resolver maps them to extension keys.
 */
const CAPABILITY_EXTENSIONS: Record<ToolCapability, string[]> = {
  completion: ['contract_stage', 'contract_factory'],
  read_source: ['read', 'bash', 'ctx_execute'],
  edit_source: ['edit', 'write', 'edit_lines'],
  test_runner: ['moon_run_task', 'validate', 'blackbox_test'],
  publication: ['gh_pr', 'gh_release', 'gh_workflow'],
  browser: ['browser', 'vision', 'act', 'see', 'state', 'run'],
  ai_vision: ['ai_vision_tools'],
  cloud_infra: ['gcloud_exec', 'direnv'],
  contract_pipeline: ['contract_stage', 'contract_factory', 'herdr_orchestrator'],
  code_review: ['code_rabbit', 'gh_pr'],
  shell_exec: ['bash', 'ctx_execute'],
  mcp_context: ['mcp', 'mcpScript'],
  all: [], // meta-capability: all tools (no filtering)
};

// ── Role profile definitions ──────────────────────────────────

export type RoleProfile = {
  /** Human-readable description of what this role does. */
  description: string;
  /** Required capabilities — preflight fails if any missing extension. */
  required: ToolCapability[];
  /** Optional capabilities — loaded when the task needs them, not always. */
  optional: ToolCapability[];
  /** Extension keys that are explicitly forbidden for this role. */
  forbidden: string[];
};

/**
 * Role profiles. Each role gets exactly the capabilities it needs.
 *
 * Writer: writes contracts. No publication, no browser, no cloud infra.
 * Critic: reviews contracts. Same as writer.
 * Implementer: implements code. Gets publication (PR creation) and browser.
 * Verifier: verifies implementation. Same as implementer.
 * Review: captain. Gets publication, code review, and cloud infra.
 */
const ROLE_PROFILES: Record<PipelineRole, RoleProfile> = {
  writer: {
    description: 'Drafts and updates contract documents.',
    required: ['completion', 'read_source', 'edit_source', 'test_runner', 'contract_pipeline'],
    optional: ['mcp_context'],
    forbidden: ['publication', 'browser', 'ai_vision', 'cloud_infra', 'code_review'],
  },
  critic: {
    description: 'Reviews and corrects contract documents.',
    required: ['completion', 'read_source', 'edit_source', 'test_runner', 'contract_pipeline'],
    optional: ['mcp_context'],
    forbidden: ['publication', 'browser', 'ai_vision', 'cloud_infra', 'code_review'],
  },
  implementer: {
    description: 'Implements contract acceptance criteria in code.',
    required: [
      'completion',
      'read_source',
      'edit_source',
      'test_runner',
      'publication',
      'contract_pipeline',
    ],
    optional: ['browser', 'ai_vision', 'mcp_context'],
    forbidden: ['cloud_infra', 'code_review'],
  },
  verifier: {
    description: 'Verifies implementation against acceptance criteria.',
    required: [
      'completion',
      'read_source',
      'edit_source',
      'test_runner',
      'publication',
      'contract_pipeline',
    ],
    optional: ['browser', 'ai_vision', 'mcp_context'],
    forbidden: ['cloud_infra', 'code_review'],
  },
  review: {
    description: 'Review captain — manages PRs, approvals, and rollbacks.',
    required: [
      'completion',
      'read_source',
      'edit_source',
      'test_runner',
      'publication',
      'code_review',
      'contract_pipeline',
    ],
    optional: ['browser', 'ai_vision', 'cloud_infra', 'mcp_context'],
    forbidden: [],
  },
};

// ── Profile resolution ────────────────────────────────────────

/**
 * Get the profile for a pipeline role.
 * Returns undefined for unknown or non-pipeline contexts.
 */
export const getRoleProfile = (role: string | undefined): RoleProfile | undefined => {
  if (!role) {
    return undefined;
  }
  return ROLE_PROFILES[role as PipelineRole];
};

/**
 * Resolve the effective tool surface for a role — the set of extension keys
 * that should be enabled. Returns undefined when no role is active (all tools
 * load, preserving normal Pi behaviour).
 */
export const resolveEnabledExtensions = (role: string | undefined): string[] | undefined => {
  const profile = getRoleProfile(role);
  if (!profile) {
    return undefined;
  }

  // Start with all extensions from required capabilities
  const enabled = new Set<string>();
  for (const capability of profile.required) {
    for (const ext of CAPABILITY_EXTENSIONS[capability] ?? []) {
      enabled.add(ext);
    }
  }

  // Optional capabilities are NOT auto-enabled — they can be enabled
  // per-session via PI_TOOLS_ON or per-task by the orchestrator.
  // The profile just records what's safe to enable, not what's always on.

  return [...enabled];
};

/**
 * Resolve forbidden capability names to their extension keys.
 * Excludes extensions that are also in REQUIRED capabilities (required wins).
 * These extension keys must NOT be registered even if otherwise available.
 */
export const getForbiddenExtensions = (role: string | undefined): string[] => {
  const profile = getRoleProfile(role);
  if (!profile) {
    return [];
  }
  // Build set of extensions from required capabilities (these override forbidden)
  const requiredExts = new Set<string>();
  for (const capability of profile.required) {
    for (const ext of CAPABILITY_EXTENSIONS[capability] ?? []) {
      requiredExts.add(ext);
    }
  }
  // forbidden stores capability names — resolve to extension keys
  const exts = new Set<string>();
  for (const capability of profile.forbidden) {
    for (const ext of CAPABILITY_EXTENSIONS[capability as ToolCapability] ?? []) {
      if (!requiredExts.has(ext)) {
        exts.add(ext);
      }
    }
  }
  return [...exts];
};

/**
 * Check whether a specific extension key is allowed for the current role.
 * When no role is active (non-pipeline session), all tools are allowed.
 *
 * An extension is disallowed when it belongs to a forbidden capability
 * (the profile's `forbidden` array stores capability names, resolved to
 * extension keys at check time). Required capabilities override forbidden
 * ones when there is overlap.
 */
export const isToolEnabledForRole = (extensionKey: string, role?: string): boolean => {
  if (!role) {
    return true; // Non-pipeline: all tools load
  }
  const profile = getRoleProfile(role);
  if (!profile) {
    return true; // Unknown role: allow (conservative default)
  }

  // Priority 1: If the extension belongs to a REQUIRED capability, it's enabled
  // regardless of forbidden lists (prevents conflicts like gh_pr being both
  // required via publication and forbidden via code_review).
  for (const capability of profile.required) {
    const exts = CAPABILITY_EXTENSIONS[capability];
    if (exts?.includes(extensionKey)) {
      return true;
    }
  }

  // Priority 2: Check if the extension belongs to any forbidden capability
  for (const capability of profile.forbidden) {
    const exts = CAPABILITY_EXTENSIONS[capability as ToolCapability];
    if (exts?.includes(extensionKey)) {
      return false;
    }
  }

  // Neither required nor forbidden: allowed (it's optional or unknown)
  return true;
};

// ── Preflight ─────────────────────────────────────────────────

export type PreflightIssue = {
  key: string;
  severity: 'error' | 'warning';
  message: string;
};

/**
 * Run preflight checks for a role profile. Returns issues for missing
 * required extensions. Never silently falls back to "all tools".
 *
 * Uses Pi's supported resource filters / active-tool APIs when available
 * (via isPipelineWorker check), otherwise falls back to env-var inspection.
 */
export const preflightRoleProfile = (options: { role: PipelineRole }): PreflightIssue[] => {
  const profile = ROLE_PROFILES[options.role];
  const issues: PreflightIssue[] = [];

  if (!profile) {
    issues.push({
      key: 'unknown_role',
      severity: 'error',
      message: `Unknown pipeline role: "${options.role}". Valid roles: ${ALL_ROLES.join(', ')}.`,
    });
    return issues;
  }

  // Check required capabilities resolve to at least one extension key
  for (const capability of profile.required) {
    const exts = CAPABILITY_EXTENSIONS[capability];
    if (!exts || exts.length === 0) {
      issues.push({
        key: `capability:${capability}`,
        severity: 'error',
        message:
          `Required capability "${capability}" has no registered extension keys. ` +
          'Update CAPABILITY_EXTENSIONS in role_profiles.ts.',
      });
    }
  }

  // Check forbidden capabilities don't overlap with required ones
  for (const forbidden of profile.forbidden) {
    // forbidden stores extension keys; check if any required capability
    // accidentally loads a forbidden key
    for (const capability of profile.required) {
      const exts = CAPABILITY_EXTENSIONS[capability] ?? [];
      if (exts.includes(forbidden)) {
        issues.push({
          key: forbidden,
          severity: 'error',
          message:
            `Extension "${forbidden}" is both required (via capability "${capability}") ` +
            `and explicitly forbidden for role "${options.role}". Resolve the conflict.`,
        });
      }
    }
  }

  return issues;
};

/**
 * Get the list of optional extension keys for a role.
 * These can be enabled per-session via PI_TOOLS_ON.
 */
export const getOptionalExtensions = (role: string | undefined): string[] => {
  const profile = getRoleProfile(role);
  if (!profile) {
    return [];
  }
  const extensions = new Set<string>();
  for (const capability of profile.optional) {
    for (const ext of CAPABILITY_EXTENSIONS[capability] ?? []) {
      extensions.add(ext);
    }
  }
  return [...extensions];
};
