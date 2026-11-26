// Pure helpers for the "Show" step: CV text, certificate details, and the LinkedIn link.
// No DOM and no storage here, so they are easy to unit test.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-03' -> 'Mar 2026'
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(ym || '');
  if (!m) return '';
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : m[1];
}

// Opens LinkedIn's "add certification" form with the fields filled in.
// The student reviews and confirms on LinkedIn. BeePath never connects to their account.
export function linkedinUrl(cert, ym) {
  const q = (k, v) => `${k}=${encodeURIComponent(v)}`;
  const parts = [q('startTask', 'CERTIFICATION_NAME'), q('name', cert.title || '')];
  if (cert.issuer) parts.push(q('organizationName', cert.issuer));
  const m = /^(\d{4})-(\d{2})/.exec(ym || '');
  if (m) { parts.push(q('issueYear', m[1])); parts.push(q('issueMonth', String(Number(m[2])))); }
  if (cert.url) parts.push(q('certUrl', cert.url));
  return `https://www.linkedin.com/profile/add?${parts.join('&')}`;
}

// The details a student needs to hand when submitting a certificate somewhere.
export function detailsText(cert, ym) {
  const lines = [`Certificate: ${cert.title}`];
  if (cert.issuer) lines.push(`Issuer: ${cert.issuer}`);
  if (ym) lines.push(`Completed: ${monthLabel(ym)}`);
  if (cert.url) lines.push(`Link: ${cert.url}`);
  return lines.join('\n');
}

// certs: [{ cert, completedOn }]   skillGroups: [{ role, skills: [name] }]
// Plain text on purpose: the student pastes it into their own CV and adds name, education and projects.
export function cvText({ certs = [], skillGroups = [] }) {
  const lines = [];
  const sorted = [...certs].sort((a, b) => (b.completedOn || '').localeCompare(a.completedOn || ''));
  if (sorted.length) {
    lines.push('CERTIFICATIONS');
    for (const { cert, completedOn } of sorted) {
      const date = monthLabel(completedOn);
      lines.push(`- ${cert.title}${cert.issuer ? `, ${cert.issuer}` : ''}${date ? ` (${date})` : ''}`);
    }
  }
  const withSkills = skillGroups.filter((g) => g.skills.length);
  if (withSkills.length) {
    if (lines.length) lines.push('');
    lines.push('SKILLS');
    for (const g of withSkills) lines.push(`${g.role}: ${g.skills.join(', ')}`);
  }
  return lines.join('\n');
}
