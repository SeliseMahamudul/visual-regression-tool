/**
 * SEC-10: live-mode navigation targets are validated against a scheme
 * allowlist, a cloud-metadata denylist, and an optional host allowlist.
 *
 * The honest framing (WEB_APP_REGRESSION_PLAN §5): classic SSRF advice does not
 * apply cleanly here, because the *legitimate* use case is reaching internal
 * hosts — staging lives on RFC1918. A blanket private-range block would break
 * the feature, so RFC1918 is DELIBERATELY allowed. The real exposures are
 * scheme abuse (file:// would render backend/.env into a JPEG and stream it to
 * the client, defeating SEC-01) and cloud metadata endpoints.
 */

/** Only these two schemes ever reach a live pane. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Cloud instance-metadata endpoints. Reaching these from a server-driven
 * browser is credential theft, not staging access.
 */
const METADATA_HOSTS = new Set([
  '169.254.169.254', // AWS / Azure IMDS
  '169.254.170.2', // AWS ECS task metadata
  '100.100.100.200', // Alibaba Cloud
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

/** 169.254.0.0/16 — link-local, covers every IMDS variant. */
function isLinkLocalIPv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  return Number(m[1]) === 169 && Number(m[2]) === 254;
}

/** Escapes regex metacharacters, then turns `*` into `.*`. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * LIVE_URL_ALLOWLIST — comma-separated host globs (`*.stage.corp,localhost`).
 * Empty (the default) means any http(s) host is allowed. Read at call time,
 * never at module load (CLAUDE.md gotcha #1).
 */
export function allowlistPatterns(): RegExp[] {
  const raw = process.env.LIVE_URL_ALLOWLIST || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

export class UrlRejectedError extends Error {
  readonly code = 'URL_REJECTED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'UrlRejectedError';
  }
}

/**
 * Returns the parsed URL, or throws UrlRejectedError with an actionable
 * message (NFR-09). Enforced on session:create, on pane:navigate, AND on
 * in-page navigation via page.on('framenavigated') for the main frame.
 */
export function assertNavigable(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new UrlRejectedError('A URL is required.');
  }

  const candidate = rawUrl.trim();

  // about:blank is the one non-http scheme we tolerate: it is the pane's own
  // initial state and carries no content.
  if (candidate === 'about:blank') {
    return new URL('about:blank');
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UrlRejectedError(
      `"${candidate}" is not a valid absolute URL. Include the scheme, e.g. https://stage.example.com`
    );
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new UrlRejectedError(
      `Scheme "${url.protocol}" is not permitted in a live pane. Only http: and https: are allowed (SEC-10).`
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (METADATA_HOSTS.has(hostname) || isLinkLocalIPv4(hostname)) {
    throw new UrlRejectedError(
      `"${url.hostname}" is a cloud instance-metadata endpoint and is blocked (SEC-10).`
    );
  }

  const patterns = allowlistPatterns();
  if (patterns.length > 0 && !patterns.some((p) => p.test(hostname))) {
    throw new UrlRejectedError(
      `Host "${url.hostname}" is not in LIVE_URL_ALLOWLIST (${process.env.LIVE_URL_ALLOWLIST}).`
    );
  }

  return url;
}

/** Non-throwing variant for the framenavigated hook, which must not reject. */
export function isNavigable(rawUrl: unknown): boolean {
  try {
    assertNavigable(rawUrl);
    return true;
  } catch {
    return false;
  }
}
