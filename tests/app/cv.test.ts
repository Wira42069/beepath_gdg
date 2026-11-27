import { expect, test } from 'vitest';
import { cvText, detailsText, linkedinUrl, monthLabel } from '@/lib/cv';

const cert = { title: 'Responsive Web Design', issuer: 'Sample Academy', url: 'https://example.com/c?id=1&x=2' };

test('monthLabel formats and tolerates bad input', () => {
  expect(monthLabel('2026-03')).toBe('Mar 2026');
  expect(monthLabel('')).toBe('');
  expect(monthLabel(undefined)).toBe('');
});

test('linkedinUrl fills the add-certification form and encodes values', () => {
  const u = new URL(linkedinUrl(cert, '2026-03'));
  expect(u.origin + u.pathname).toBe('https://www.linkedin.com/profile/add');
  expect(u.searchParams.get('startTask')).toBe('CERTIFICATION_NAME');
  expect(u.searchParams.get('name')).toBe('Responsive Web Design');
  expect(u.searchParams.get('organizationName')).toBe('Sample Academy');
  expect(u.searchParams.get('issueYear')).toBe('2026');
  expect(u.searchParams.get('issueMonth')).toBe('3');
  expect(u.searchParams.get('certUrl')).toBe(cert.url);
});

test('linkedinUrl omits what it does not have', () => {
  const u = new URL(linkedinUrl({ title: 'X' }, ''));
  expect(u.searchParams.get('organizationName')).toBeNull();
  expect(u.searchParams.get('issueYear')).toBeNull();
  expect(u.searchParams.get('certUrl')).toBeNull();
});

test('detailsText lists only known fields, including the Binus archive code', () => {
  expect(detailsText({ title: 'X' }, '')).toBe('Certificate: X');
  expect(detailsText(cert, '2026-03')).toMatch(/Completed: Mar 2026/);
  expect(detailsText({ title: 'X', code: 'CERT006132' })).toBe('Certificate: X\nBinus archive code: CERT006132');
});

test('cvText: newest certificates first, skills grouped by role, empty when nothing to show', () => {
  const out = cvText({
    certs: [{ cert: { title: 'Old', issuer: 'A' }, completedOn: '2025-01' }, { cert: { title: 'New' }, completedOn: '2026-02' }],
    skillGroups: [{ role: 'Frontend Developer', skills: ['HTML', 'CSS'] }, { role: 'Other', skills: [] }],
  });
  expect(out).toBe('CERTIFICATIONS\n- New (Feb 2026)\n- Old, A (Jan 2025)\n\nSKILLS\nFrontend Developer: HTML, CSS');
  expect(cvText({})).toBe('');
});
