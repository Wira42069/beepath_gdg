// Pure text helpers. No browser, no I/O, so they are easy to unit test.

/** Collapse runs of spaces inside each line, trim lines, drop leading/trailing blank lines. */
export function normalizeText(value) {
  if (value == null) return null;
  const lines = String(value)
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim());
  const out = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const text = out.join('\n');
  return text === '' ? null : text;
}

/** The archive uses "Not Defined" (and a few variants) for empty fields. */
export function emptyToNull(value) {
  const text = normalizeText(value);
  if (text == null) return null;
  return /^(not defined|n\/?a|-|tidak ada)$/i.test(text) ? null : text;
}

/** "CERT006132 - Introduction to Software Testing" -> { code, title } */
export function splitCodeTitle(raw) {
  const text = normalizeText(raw) ?? '';
  const m = text.match(/^(CERT\d+)\s*[-–—:]\s*([\s\S]+)$/i);
  if (m) return { code: m[1].toUpperCase(), title: m[2].trim() };
  return { code: null, title: text };
}

/** The list view cuts long text and ends it with " ..." */
export function isTruncated(value) {
  return typeof value === 'string' && /(?:\s\.{3}|…)$/.test(value.trim());
}

/** "Showing 11 to 20 of 3539 entries" -> { from: 11, to: 20, total: 3539 } */
export function parseShowing(text) {
  const m = String(text ?? '').match(/Showing\s+([\d.,]+)\s+to\s+([\d.,]+)\s+of\s+([\d.,]+)\s+entries/i);
  if (!m) return null;
  const n = (s) => Number(s.replace(/[.,]/g, ''));
  return { from: n(m[1]), to: n(m[2]), total: n(m[3]) };
}

/** Page number for a "Showing" range, given the page size observed on page 1. */
export function pageOf(showing, pageSize) {
  if (!showing || !pageSize) return null;
  return Math.floor((showing.from - 1) / pageSize) + 1;
}

/** "/Student/CertificateInfo?ID=63ee..." -> "63ee..." */
export function idFromHref(href) {
  if (!href) return null;
  const m = String(href).match(/[?&]ID=([^&#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** "javascript:__doPostBack('ctl00$MainContent$PageButtonNext','')" -> "ctl00$MainContent$PageButtonNext" */
export function postBackTarget(href) {
  const m = String(href ?? '').match(/__doPostBack\('([^']+)'/);
  return m ? m[1] : null;
}

/**
 * Never print the one-time login token. BinusMaya hands it over as ?Token=... and
 * anyone holding it could open the certification app as this student.
 */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/token|code|session|sig|auth/i.test(key)) u.searchParams.set(key, 'REDACTED');
    }
    return u.toString();
  } catch {
    return String(url).replace(/([?&](?:token|code|sig)[^=]*=)[^&#]*/gi, '$1REDACTED');
  }
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
