import test from 'node:test';
import assert from 'node:assert/strict';
import { monthLabel, linkedinUrl, detailsText, cvText } from '../js/cv.js';

const cert = { title: 'Responsive Web Design', issuer: 'Sample Academy', url: 'https://example.com/c?id=1&x=2' };

test('monthLabel formats and tolerates bad input', () => {
  assert.equal(monthLabel('2026-03'), 'Mar 2026');
  assert.equal(monthLabel(''), '');
  assert.equal(monthLabel(undefined), '');
});

test('linkedinUrl fills the add-certification form and encodes values', () => {
  const u = new URL(linkedinUrl(cert, '2026-03'));
  assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/profile/add');
  assert.equal(u.searchParams.get('startTask'), 'CERTIFICATION_NAME');
  assert.equal(u.searchParams.get('name'), 'Responsive Web Design');
  assert.equal(u.searchParams.get('organizationName'), 'Sample Academy');
  assert.equal(u.searchParams.get('issueYear'), '2026');
  assert.equal(u.searchParams.get('issueMonth'), '3');
  assert.equal(u.searchParams.get('certUrl'), cert.url);
});

test('linkedinUrl omits what it does not have', () => {
  const u = new URL(linkedinUrl({ title: 'X' }, ''));
  assert.equal(u.searchParams.get('organizationName'), null);
  assert.equal(u.searchParams.get('issueYear'), null);
  assert.equal(u.searchParams.get('certUrl'), null);
});

test('detailsText lists only known fields', () => {
  assert.equal(detailsText({ title: 'X' }, ''), 'Certificate: X');
  assert.match(detailsText(cert, '2026-03'), /Completed: Mar 2026/);
});

test('cvText: newest certificates first, skills grouped by role, empty when nothing to show', () => {
  const out = cvText({
    certs: [{ cert: { title: 'Old', issuer: 'A' }, completedOn: '2025-01' }, { cert: { title: 'New' }, completedOn: '2026-02' }],
    skillGroups: [{ role: 'Frontend Developer', skills: ['HTML', 'CSS'] }, { role: 'Other', skills: [] }],
  });
  assert.equal(out, 'CERTIFICATIONS\n- New (Feb 2026)\n- Old, A (Jan 2025)\n\nSKILLS\nFrontend Developer: HTML, CSS');
  assert.equal(cvText({}), '');
});
