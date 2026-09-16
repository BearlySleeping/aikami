// apps/frontend/client/src/lib/utils/theme/theme_install_intent.ts
//
// C-530 AC-5 / AC-7 — parsing a theme install handoff.
//
// 🔴 The handoff carries an *identity*, never a source. A deep link, a pasted
// URL or a browser history entry can therefore never name an origin, a
// filesystem path or a package to execute: the only thing this parser can
// produce is `{ themeId, version, source: 'configured-hub' }`, and the consumer
// resolves it against `hubApiBase()` — the one endpoint the client is already
// configured to trust.
//
// Two accepted shapes, both deliberately narrow:
//   aikami://theme/<themeId>?version=<version>
//   aikami://theme/<themeId>@<version>
//   /community/themes/<themeId>?version=<version>   (same-origin hub path)
//
// Everything else — another scheme, a host, a query that names a URL, a
// traversal segment, a missing or malformed version — returns undefined.
// Parsing can never auto-apply a pack; the caller still stages and previews.

import { THEME_ID_PATTERN, THEME_VERSION_PATTERN } from '@aikami/constants';
import type { ThemeInstallIntent } from '@aikami/types';

/** The only scheme a theme handoff may use. */
export const THEME_DEEP_LINK_SCHEME = 'aikami';

/** The only deep-link host a theme handoff may use. */
export const THEME_DEEP_LINK_HOST = 'theme';

/** The same-origin hub path a handoff may use instead of the deep link. */
export const THEME_HUB_PATH_PREFIX = '/community/themes/';

/** Longest accepted handoff text. */
const MAX_HANDOFF_LENGTH = 256;

const THEME_ID_RE = new RegExp(THEME_ID_PATTERN);
const THEME_VERSION_RE = new RegExp(THEME_VERSION_PATTERN);

/**
 * Any traversal segment or encoded separator is refused before parsing.
 *
 * `..` and an encoded dot, slash or backslash have no legitimate place in a
 * theme handoff; the scheme's own `://` is not matched here.
 */
const TRAVERSAL_RE = /\.\.|%2e|%2f|%5c|\\/i;

const buildIntent = (themeId: string, version: string): ThemeInstallIntent | undefined => {
  if (!THEME_ID_RE.test(themeId) || !THEME_VERSION_RE.test(version)) {
    return undefined;
  }
  return { themeId, version, source: 'configured-hub' };
};

/** Reads one `version=` value out of a query string. */
const versionFromQuery = (query: string): string | undefined => {
  const params = new URLSearchParams(query);
  const value = params.get('version');
  if (value === null || value.length === 0) {
    return undefined;
  }
  // A query may only carry the version — anything else is not a theme handoff.
  const allowed = new Set(['version']);
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      return undefined;
    }
  }
  return value;
};

/**
 * Parses a theme install handoff into a trusted identity.
 *
 * @returns The intent, or undefined when the text is not a well-formed theme
 *   handoff. Never throws, never returns a URL or a path.
 */
export const parseThemeInstallIntent = (raw: string): ThemeInstallIntent | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HANDOFF_LENGTH) {
    return undefined;
  }
  // A protocol-relative URL is not a handoff, and it is the one shape the
  // traversal guard deliberately does not cover.
  if (trimmed.startsWith('//')) {
    return undefined;
  }
  if (TRAVERSAL_RE.test(trimmed)) {
    return undefined;
  }

  // Deep link: aikami://theme/<id>[?version=..]  or  aikami://theme/<id>@<version>
  if (trimmed.startsWith(`${THEME_DEEP_LINK_SCHEME}://`)) {
    const rest = trimmed.slice(`${THEME_DEEP_LINK_SCHEME}://`.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      return undefined;
    }
    const host = rest.slice(0, slash);
    if (host !== THEME_DEEP_LINK_HOST) {
      return undefined;
    }
    const target = rest.slice(slash + 1);
    if (target.length === 0 || target.includes('/')) {
      return undefined;
    }
    const queryIndex = target.indexOf('?');
    if (queryIndex >= 0) {
      const id = target.slice(0, queryIndex);
      const version = versionFromQuery(target.slice(queryIndex + 1));
      return version === undefined ? undefined : buildIntent(id, version);
    }
    const at = target.indexOf('@');
    if (at < 1) {
      return undefined;
    }
    return buildIntent(target.slice(0, at), target.slice(at + 1));
  }

  // Same-origin hub path: /community/themes/<id>?version=<version>
  if (trimmed.startsWith(THEME_HUB_PATH_PREFIX)) {
    const target = trimmed.slice(THEME_HUB_PATH_PREFIX.length);
    if (target.length === 0 || target.includes('/')) {
      return undefined;
    }
    const queryIndex = target.indexOf('?');
    if (queryIndex < 1) {
      return undefined;
    }
    const version = versionFromQuery(target.slice(queryIndex + 1));
    return version === undefined ? undefined : buildIntent(target.slice(0, queryIndex), version);
  }

  return undefined;
};

/** Builds the canonical deep link for an intent (the native handoff payload). */
export const buildThemeInstallDeepLink = (intent: ThemeInstallIntent): string =>
  `${THEME_DEEP_LINK_SCHEME}://${THEME_DEEP_LINK_HOST}/${intent.themeId}?version=${encodeURIComponent(intent.version)}`;

/** The trusted hub URL an intent resolves to. Never taken from the handoff. */
export const themePackageUrl = (intent: ThemeInstallIntent, hubApiBase: string): string =>
  `${hubApiBase.replace(/\/$/, '')}/assets/themes/${encodeURIComponent(intent.themeId)}/public?version=${encodeURIComponent(intent.version)}`;
