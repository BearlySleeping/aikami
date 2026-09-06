// .pi/scripts/resource_manifest.ts
//
// C-478: Resource manifest — exact version/revision tracking, content
// provenance, worktree identity, and provenance report generation.
//
// The manifest records what resources are *intended* to be installed and
// the *provenance* of what is actually installed, so a maintainer can
// inspect, reproduce, or roll back a resource graph without guessing.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ────────────────────────────────────────────────────────────

export type ResourceType = 'npm-package' | 'git-skill' | 'local-skill' | 'generated-skill';

/**
 * Provenance entry for one managed resource.
 * Each entry records what *should* be installed (source + pinned ref) and
 * what *is* installed (content hash + selected paths).
 */
export type ResourceEntry = {
  /** Canonical name — matches a key in settings.json → packages[] or skills[] */
  name: string;
  /** Category used for reporting and grouping */
  type: ResourceType;
  /** Human-readable description */
  description: string;
  /** Where this resource comes from */
  source: ResourceSource;
  /** Content identity of the installed resource */
  installed: InstalledIdentity;
};

export type ResourceSource =
  | { kind: 'npm'; package: string; version: string }
  | { kind: 'git'; url: string; revision: string; subdir: string }
  | { kind: 'local'; relativePath: string };

export type InstalledIdentity = {
  /** SHA-256 hex digest of the installed resource content */
  contentHash: string;
  /** Number of files in the installed resource tree */
  fileCount: number;
  /** ISO-8601 timestamp of when this identity was recorded */
  recordedAt: string;
};

export type ResourceManifest = {
  /** Schema version for forward compatibility */
  manifestVersion: 1;
  /** ISO-8601 timestamp of when the manifest was last updated */
  updatedAt: string;
  /** Entries keyed by resource name */
  resources: Record<string, ResourceEntry>;
};

// ── Constants ────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PI_DIR = resolve(__dirname, '..');
export const MANIFEST_PATH = join(PI_DIR, 'resource-manifest.json');
export const SETTINGS_PATH = join(PI_DIR, 'settings.json');
export const GENERATED_SKILLS_DIR = join(PI_DIR, 'generated-skills');
export const SKILLS_DIR = join(PI_DIR, 'skills');
export const EXTENSIONS_DIR = join(PI_DIR, 'extensions');

// ── Manifest I/O ─────────────────────────────────────────────────────

/**
 * Load the resource manifest from disk.
 * Returns undefined if the manifest does not exist.
 * @param manifestPath — optional override path (defaults to MANIFEST_PATH)
 */
export const loadManifest = async (
  manifestPath?: string,
): Promise<ResourceManifest | undefined> => {
  const path = manifestPath ?? MANIFEST_PATH;
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as ResourceManifest;
};

/**
 * Save a resource manifest to disk.
 * @param manifestPath — optional override path (defaults to MANIFEST_PATH)
 */
export const saveManifest = async (
  manifest: ResourceManifest,
  manifestPath?: string,
): Promise<void> => {
  const path = manifestPath ?? MANIFEST_PATH;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

/**
 * Create an empty manifest skeleton.
 */
export const createManifest = (): ResourceManifest => ({
  manifestVersion: 1,
  updatedAt: new Date().toISOString(),
  resources: {},
});

// ── Content hashing ──────────────────────────────────────────────────

/**
 * Compute the SHA-256 content hash of a file.
 */
export const hashFile = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
};

/**
 * Walk a directory tree and compute a combined content hash.
 * Returns the SHA-256 of the sorted list of (relativePath → sha256) pairs.
 */
export const hashDirectory = async (dirPath: string): Promise<InstalledIdentity> => {
  if (!existsSync(dirPath)) {
    return { contentHash: '', fileCount: 0, recordedAt: new Date().toISOString() };
  }

  const files: string[] = [];
  const walk = (dir: string): void => {
    const entries = require('node:fs').readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };
  walk(dirPath);

  files.sort();

  const hash = createHash('sha256');
  for (const filePath of files) {
    const relPath = relative(dirPath, filePath);
    const fileHash = await hashFile(filePath);
    hash.update(`${relPath}\0${fileHash}\0`);
  }

  return {
    contentHash: hash.digest('hex'),
    fileCount: files.length,
    recordedAt: new Date().toISOString(),
  };
};

// ── Settings parser ──────────────────────────────────────────────────

export type PinnedSettings = {
  packages: string[];
  skills: string[];
  extensions: string[];
  prompts: string[];
};

/**
 * Load and parse the current settings.json into a structured form.
 */
export const loadSettings = async (): Promise<PinnedSettings> => {
  const raw = await readFile(SETTINGS_PATH, 'utf-8');
  const settings = JSON.parse(raw) as {
    packages?: string[];
    skills?: string[];
    extensions?: string[];
    prompts?: string[];
  };
  return {
    packages: settings.packages ?? [],
    skills: settings.skills ?? [],
    extensions: settings.extensions ?? [],
    prompts: settings.prompts ?? [],
  };
};

/**
 * Normalize a package spec from settings.json into a structured source.
 * Supports "npm:<name>" and "git:<url>" formats.
 */
export const parsePackageSpec = (spec: string): ResourceSource | undefined => {
  if (spec.startsWith('npm:')) {
    const parts = spec.slice(4).split('@');
    const packageName = parts[0] ?? spec.slice(4);
    const version = parts[1] ?? 'latest';
    return { kind: 'npm' as const, package: packageName, version };
  }
  if (spec.startsWith('git:')) {
    return { kind: 'git' as const, url: spec.slice(4), revision: 'HEAD', subdir: '' };
  }
  return undefined;
};

// ── Resource-graph identity (AC-4) ───────────────────────────────────

export type ResourceGraphIdentity = {
  /** SHA-256 of the manifest content (keys + entries, normalized) */
  manifestHash: string;
  /** SHA-256 of the normalized settings.json selections */
  settingsHash: string;
  /** SHA-256 of generated resource content hashes */
  generatedContentHash: string;
  /** Combined identity hash */
  combinedHash: string;
};

/**
 * Compute the resource-graph identity for a checkout.
 * AC-4: compares three inputs — committed lockfile data, settings selections,
 * and generated content hashes.
 */
export const computeResourceGraphIdentity = async (
  manifest: ResourceManifest | undefined,
  settings?: PinnedSettings,
): Promise<ResourceGraphIdentity> => {
  // 1. Manifest hash
  const manifestHash = manifest
    ? createHash('sha256')
        .update(JSON.stringify(manifest.resources, Object.keys(manifest.resources).sort()))
        .digest('hex')
    : 'no-manifest';

  // 2. Settings hash
  const resolvedSettings = settings ?? (await loadSettings());
  const settingsPayload = JSON.stringify(resolvedSettings, Object.keys(resolvedSettings).sort());
  const settingsHash = createHash('sha256').update(settingsPayload).digest('hex');

  // 3. Generated content hash — hash the generated-skills directory
  const genIdentity = await hashDirectory(GENERATED_SKILLS_DIR);
  const generatedContentHash = genIdentity.contentHash || 'no-generated-content';

  // 4. Combined
  const combinedPayload = `${manifestHash}:${settingsHash}:${generatedContentHash}`;
  const combinedHash = createHash('sha256').update(combinedPayload).digest('hex');

  return { manifestHash, settingsHash, generatedContentHash, combinedHash };
};

/**
 * Compare two resource-graph identities and return differences.
 */
export const compareGraphIdentities = (
  a: ResourceGraphIdentity,
  b: ResourceGraphIdentity,
): string[] => {
  const diffs: string[] = [];
  if (a.manifestHash !== b.manifestHash) {
    diffs.push('manifest');
  }
  if (a.settingsHash !== b.settingsHash) {
    diffs.push('settings');
  }
  if (a.generatedContentHash !== b.generatedContentHash) {
    diffs.push('generated-content');
  }
  return diffs;
};

// ── Provenance report (AC-5) ─────────────────────────────────────────

export type ProvenanceReport = {
  generatedAt: string;
  totalResources: number;
  resourceTypes: Record<ResourceType, number>;
  entries: ResourceEntry[];
  unmanagedCoverageGaps: string[];
  identity: ResourceGraphIdentity;
};

/**
 * Generate a provenance report from the current manifest and disk state.
 */
export const generateProvenanceReport = async (
  manifest: ResourceManifest | undefined,
): Promise<ProvenanceReport> => {
  const entries = manifest ? Object.values(manifest.resources) : [];
  const resourceTypes: Record<string, number> = {};
  for (const entry of entries) {
    resourceTypes[entry.type] = (resourceTypes[entry.type] ?? 0) + 1;
  }

  // Detect unmanaged coverage gaps
  const unmanagedCoverageGaps: string[] = [];
  if (existsSync(GENERATED_SKILLS_DIR)) {
    const dirs = require('node:fs').readdirSync(GENERATED_SKILLS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory() && !manifest?.resources[dir.name]) {
        unmanagedCoverageGaps.push(`generated-skills/${dir.name}`);
      }
    }
  }
  if (existsSync(SKILLS_DIR)) {
    const dirs = require('node:fs').readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory() && !manifest?.resources[dir.name]) {
        unmanagedCoverageGaps.push(`skills/${dir.name}`);
      }
    }
  }

  const settings = await loadSettings();
  const identity = await computeResourceGraphIdentity(manifest, settings);

  return {
    generatedAt: new Date().toISOString(),
    totalResources: entries.length,
    resourceTypes: resourceTypes as Record<ResourceType, number>,
    entries,
    unmanagedCoverageGaps,
    identity,
  };
};

/**
 * Format a provenance report as a human-readable string.
 */
export const formatProvenanceReport = (report: ProvenanceReport): string => {
  const lines: string[] = [];
  lines.push('=== Resource Provenance Report ===');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Total managed resources: ${report.totalResources}`);
  lines.push('');

  lines.push('Resource types:');
  for (const [type, count] of Object.entries(report.resourceTypes)) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');

  lines.push('Resource identity:');
  lines.push(`  manifest-hash:        ${report.identity.manifestHash.slice(0, 16)}…`);
  lines.push(`  settings-hash:        ${report.identity.settingsHash.slice(0, 16)}…`);
  lines.push(`  generated-content:    ${report.identity.generatedContentHash.slice(0, 16)}…`);
  lines.push(`  combined:             ${report.identity.combinedHash.slice(0, 16)}…`);
  lines.push('');

  if (report.entries.length > 0) {
    lines.push('Resources:');
    for (const entry of report.entries) {
      lines.push(`  ${entry.name} (${entry.type})`);
      lines.push(`    source: ${formatSource(entry.source)}`);
      lines.push(
        `    hash: ${entry.installed.contentHash.slice(0, 16)}… (${entry.installed.fileCount} files)`,
      );
    }
  }
  lines.push('');

  if (report.unmanagedCoverageGaps.length > 0) {
    lines.push('Unmanaged coverage gaps:');
    for (const gap of report.unmanagedCoverageGaps) {
      lines.push(`  - ${gap}`);
    }
    lines.push('');
  } else {
    lines.push('No unmanaged coverage gaps detected.');
    lines.push('');
  }

  lines.push('=== End Report ===');
  return lines.join('\n');
};

const formatSource = (source: ResourceSource): string => {
  switch (source.kind) {
    case 'npm':
      return `npm:${source.package}@${source.version}`;
    case 'git':
      return `git:${source.url}#${source.revision.slice(0, 12)}`;
    case 'local':
      return `local:${source.relativePath}`;
  }
};
