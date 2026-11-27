// Everything we know about the Binus student certification site in one place.
// If the site changes its markup, this file (and archive.mjs) is where to look.

export const DEFAULTS = {
  // The certification app (ASP.NET WebForms). Every page under /Student/ needs a session.
  origin: 'https://studentcertification.apps.binus.ac.id',
  // Where a student signs in. BinusMaya creates a one-time ?Token=... and opens the
  // certification app with it, which sets the session cookie we then reuse.
  loginUrl: 'https://binusmaya.binus.ac.id/',
};

export const PATHS = {
  dashboard: '/Student/Dashboard',
  detail: '/Student/CertificateInfo',
};

/** True when a URL is a signed-in page of the certification app. */
export function isAuthedUrl(url, origin) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== new URL(origin).origin) return false;
  return /^\/student\//i.test(u.pathname) && !isUnauthorizedPath(u.pathname);
}

export function isUnauthorizedPath(pathname) {
  return /\/unauthori[sz]e/i.test(pathname);
}

/** Chrome shows chrome-error:// when the request never reached the site (offline, DNS, sleep). */
export function isBrowserErrorUrl(url) {
  return /^chrome-error:/i.test(String(url));
}

/** True when the app has bounced us out: /UnAuthorize, or off to another host (BinusMaya, Microsoft). */
export function isSignedOutUrl(url, origin) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'about:' || isBrowserErrorUrl(url)) return false;
  return u.origin !== new URL(origin).origin || isUnauthorizedPath(u.pathname);
}

export function detailUrl(origin, id) {
  return `${origin}${PATHS.detail}?ID=${encodeURIComponent(id)}`;
}

export class SessionExpiredError extends Error {
  constructor(where) {
    super(`Session expired or signed out (${where})`);
    this.name = 'SessionExpiredError';
  }
}

// Errors where the request never reached the site: this computer is offline, asleep, or DNS failed.
// Chrome reports net::ERR_*, Playwright's HTTP client (used for session checks) reports Node's E* codes.
const NETWORK_ERRORS = /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_IO_SUSPENDED|NETWORK_CHANGED|NETWORK_ACCESS_DENIED|ADDRESS_UNREACHABLE|CONNECTION_(RESET|REFUSED|CLOSED|TIMED_OUT|FAILED)|TIMED_OUT|PROXY_CONNECTION_FAILED|SSL_PROTOCOL_ERROR)|\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|ENETDOWN|EHOSTUNREACH)\b/;

export class NetworkError extends Error {
  constructor(detail) {
    super(`Network unavailable (${detail})`);
    this.name = 'NetworkError';
  }
}

export function isNetworkError(err) {
  return err instanceof NetworkError || NETWORK_ERRORS.test(String(err?.message ?? err));
}

/** Turns a Playwright navigation error into NetworkError when the request never reached the site. */
export function asNetworkError(err, where) {
  if (!isNetworkError(err)) return null;
  return err instanceof NetworkError ? err : new NetworkError(String(err.message).match(/ERR_[A-Z_]+|\bE[A-Z_]{4,}\b/)?.[0] ?? where);
}

export class LoginAbortedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoginAbortedError';
  }
}
