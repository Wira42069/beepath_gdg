// Browser-only persistence: no accounts, no student data.
// Everything lives in localStorage, with an in-memory fallback if storage is blocked.

const PREFIX = 'beepath.v1.';
const mem = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}
function write(key, value) {
  mem.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked: memory only */ }
}

export function anonId() {
  let id = read('anonId', null);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    write('anonId', id);
  }
  return id;
}

// ---- Skill progress: { [roleId]: { [skillId]: 'doing' | 'done' } } ----
export const STATUSES = ['todo', 'doing', 'done'];

export function getStatus(roleId, skillId) {
  return read('progress', {})[roleId]?.[skillId] || 'todo';
}
export function setStatus(roleId, skillId, status) {
  const all = read('progress', {});
  all[roleId] = all[roleId] || {};
  if (status === 'todo') delete all[roleId][skillId]; else all[roleId][skillId] = status;
  write('progress', all);
}

// ---- Ratings: { 'certId|skillId': { stars, relevant, ts } } ----
export function getMyRatings() { return read('ratings', {}); }
export function setMyRating(certId, skillId, { stars, relevant }) {
  const all = getMyRatings();
  all[`${certId}|${skillId}`] = { stars, relevant, ts: Date.now() };
  write('ratings', all);
}

export function exportRatings(datasetId) {
  const mine = getMyRatings();
  return {
    datasetId,
    anonId: anonId(),
    exportedAt: new Date().toISOString(),
    ratings: Object.entries(mine).map(([k, r]) => {
      const [certificateId, skillId] = k.split('|');
      return { certificateId, skillId, stars: r.stars, relevant: r.relevant };
    }),
  };
}

// ---- Completed certificates: { [certId]: { skillId, completedOn: 'YYYY-MM', submittedToBinus, ts } } ----
// "Submitted to Binus" is self-reported: BeePath cannot see the campus system.
export function getCompleted() { return read('completed', {}); }
export function setCompleted(certId, skillId, completedOn) {
  const all = getCompleted();
  if (all[certId]) return;
  all[certId] = { skillId: skillId || null, completedOn, submittedToBinus: false, ts: Date.now() };
  write('completed', all);
}
export function updateCompleted(certId, patch) {
  const all = getCompleted();
  if (!all[certId]) return;
  all[certId] = { ...all[certId], ...patch };
  write('completed', all);
}
export function removeCompleted(certId) {
  const all = getCompleted();
  delete all[certId];
  write('completed', all);
}
