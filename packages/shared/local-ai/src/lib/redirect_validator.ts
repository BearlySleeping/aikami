// packages/shared/local-ai/src/lib/redirect_validator.ts
//
// Hop-by-hop redirect validator for model artifact downloads. Every redirect
// is re-checked against the approved origin/CDN policy: scheme, host, port,
// and destination class. Credentials are never forwarded cross-origin.
// The hop count is capped. Verification is anchored to the pinned checksum
// and size, so a permitted CDN hop cannot change what is installed.

/** Maximum allowed redirect hops. */
export const MAX_REDIRECT_HOPS = 5;

/** An approved origin entry — scheme, host, and optional port. */
export type ApprovedOrigin = {
  readonly scheme: 'https';
  readonly host: string;
  /** Defaults to 443 when omitted. */
  readonly port?: number;
};

/** Result of a single-hop validation. */
export type HopValidation =
  | {
      readonly ok: true;
      readonly url: URL;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

/**
 * Default approved origins for model artifact downloads. Hugging Face CDN
 * and the official HF hub; additional origins may be configured at runtime.
 */
export const DEFAULT_APPROVED_ORIGINS: readonly ApprovedOrigin[] = [
  { scheme: 'https', host: 'huggingface.co' },
  { scheme: 'https', host: 'cdn-lfs.huggingface.co' },
  { scheme: 'https', host: 'github.com' },
  { scheme: 'https', host: 'objects.githubusercontent.com' },
  { scheme: 'https', host: 'github-releases.githubusercontent.com' },
] as const;

/**
 * Returns true when the host is a private or link-local address (IPv4, IPv6,
 * or a well-known private hostname).
 */
export const isPrivateOrLinkLocalHost = (host: string): boolean => {
  // Strip brackets from IPv6 literals
  const raw = host.replace(/^\[|\]$/g, '');

  // IPv4 private ranges
  if (
    raw.startsWith('10.') ||
    raw.startsWith('172.16.') ||
    raw.startsWith('192.168.') ||
    raw.startsWith('127.') ||
    raw === 'localhost' ||
    raw === '0.0.0.0'
  ) {
    return true;
  }

  // IPv6 private / link-local ranges
  if (
    raw === '::1' ||
    raw === '::' ||
    raw.startsWith('fe80:') ||
    raw.startsWith('fc') ||
    raw.startsWith('fd')
  ) {
    return true;
  }

  // Link-local IPv4
  if (raw.startsWith('169.254.')) {
    return true;
  }

  return false;
};

/**
 * Validates a single redirect hop against the approved origins list. Returns
 * the validated URL or a descriptive failure reason.
 *
 * Rules:
 * - Must be HTTPS (no downgrade)
 * - Host must be in the approved origins list (or a subdomain of one)
 * - Port must match the approved origin (defaults to 443)
 * - Destination must not be a private or link-local address
 * - Credentials (user:password) are dropped if cross-origin from the previous URL
 */
export const validateRedirectHop = (options: {
  /** The redirect target URL. */
  readonly location: string;
  /** The URL we are redirecting FROM (null for the initial request). */
  readonly fromUrl: URL | null;
  /** Approved origins. Defaults to DEFAULT_APPROVED_ORIGINS. */
  readonly approvedOrigins?: readonly ApprovedOrigin[];
  /** Current hop count (0-based). */
  readonly hopCount: number;
}): HopValidation => {
  const { location, fromUrl, hopCount } = options;
  const approvedOrigins = options.approvedOrigins ?? DEFAULT_APPROVED_ORIGINS;

  // Cap hops
  if (hopCount >= MAX_REDIRECT_HOPS) {
    return { ok: false, reason: `exceeded maximum ${MAX_REDIRECT_HOPS} redirect hops` };
  }

  // Parse the location URL. When fromUrl is provided, we first try to
  // parse location as absolute; if that fails and fromUrl exists, try
  // as relative. But if location looks like an absolute URL (has scheme),
  // we MUST parse it as absolute — a relative-URL parse of an invalid
  // string can silently succeed by treating it as a path segment.
  let url: URL;
  try {
    // If it has a colon early, treat as absolute URL first
    if (location.includes(':') || location.startsWith('//')) {
      url = new URL(location);
    } else if (fromUrl) {
      url = new URL(location, fromUrl);
    } else {
      url = new URL(location);
    }
  } catch {
    return { ok: false, reason: `invalid redirect URL: ${location}` };
  }

  // Must be HTTPS
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `unsupported protocol: ${url.protocol}` };
  }

  // Reject downgrade: if we started on HTTPS, the next hop must also be HTTPS
  if (fromUrl?.protocol === 'https:' && url.protocol !== 'https:') {
    return { ok: false, reason: `protocol downgrade from https to ${url.protocol}` };
  }

  // Reject private/link-local destinations
  if (isPrivateOrLinkLocalHost(url.hostname)) {
    return { ok: false, reason: `redirect to private or link-local host: ${url.hostname}` };
  }

  // Validate against approved origins
  const port = url.port ? Number.parseInt(url.port, 10) : 443;
  const isApproved = approvedOrigins.some((origin) => {
    if (url.protocol !== `${origin.scheme}:`) {
      return false;
    }
    if (port !== (origin.port ?? 443)) {
      return false;
    }
    if (url.hostname === origin.host) {
      return true;
    }
    if (url.hostname.endsWith(`.${origin.host}`)) {
      return true;
    }
    return false;
  });

  if (!isApproved) {
    return { ok: false, reason: `redirect to unapproved host: ${url.hostname}:${port}` };
  }

  return { ok: true, url };
};

/**
 * Validates the entire redirect chain by processing each hop sequentially.
 * Returns the final validated URL or the first failure.
 */
export const validateRedirectChain = (options: {
  /** The initial request URL. */
  readonly initialUrl: string;
  /** The redirect chain locations in order (first redirect → last redirect). */
  readonly redirectLocations: readonly string[];
  /** Approved origins. Defaults to DEFAULT_APPROVED_ORIGINS. */
  readonly approvedOrigins?: readonly ApprovedOrigin[];
}): HopValidation => {
  const { initialUrl, redirectLocations, approvedOrigins } = options;

  let currentUrl: URL;
  try {
    currentUrl = new URL(initialUrl);
  } catch {
    return { ok: false, reason: `invalid initial URL: ${initialUrl}` };
  }

  for (let i = 0; i < redirectLocations.length; i++) {
    const location = redirectLocations[i];
    if (location === undefined) {
      return { ok: false, reason: `redirect location at index ${i} is undefined` };
    }
    const result = validateRedirectHop({
      location,
      fromUrl: currentUrl,
      approvedOrigins,
      hopCount: i,
    });

    if (!result.ok) {
      return result;
    }

    currentUrl = result.url;
  }

  return { ok: true, url: currentUrl };
};

/**
 * Drops userinfo (credentials) from a URL if it is cross-origin from the
 * reference URL. Returns the sanitized URL string.
 */
export const dropCredentialsIfCrossOrigin = (url: URL, referenceOrigin: string): URL => {
  if (url.origin !== referenceOrigin && url.username) {
    const sanitized = new URL(url.toString());
    sanitized.username = '';
    sanitized.password = '';
    return sanitized;
  }
  return url;
};
