import { CONFIG } from './config.js';
import { loadData } from './data.js';
import { aggregateRatings, ratingSummary, rankCertificates, matchLabel } from './ranking.js';
import * as store from './store.js';
import { linkedinUrl, detailsText, cvText, monthLabel } from './cv.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Certificate data may come from a scrape, so never trust URLs or text.
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

let D = null;
const ui = {
  freeOnly: false, maxHours: 0, showAll: false, rate: null /* { key, stars, relevant } */,
  arch: { q: '', skill: '', category: '', freeOnly: false, maxHours: 0, limit: 50 },
};
let lastRoute = '';

// ---------- routing ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'role' && parts[1]) return { name: 'role', roleId: parts[1], skillId: parts[2] || null };
  if (parts[0] === 'archive') return { name: 'archive' };
  if (parts[0] === 'me') return { name: 'me' };
  return { name: 'home' };
}
const routeKey = (r) => (r.name === 'role' ? r.roleId : r.name);
const roleHref = (roleId, skillId) => `#/role/${encodeURIComponent(roleId)}${skillId ? '/' + encodeURIComponent(skillId) : ''}`;

// ---------- formatting ----------
function fmtPrice(p) {
  if (!p || typeof p.amount !== 'number') return 'Price not listed';
  if (p.amount === 0) return 'Free';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: p.currency || 'IDR', maximumFractionDigits: 0 }).format(p.amount);
}
const fmtHours = (h) => (typeof h === 'number' ? `about ${h} h` : 'Duration not listed');
const stars = (avg) => '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- chrome ----------
const logo = '<svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="#f2a900"/><polygon points="32,14 47,23 47,41 32,50 17,41 17,23" fill="#0c2f3a"/><polygon points="32,24 40,28.5 40,37.5 32,42 24,37.5 24,28.5" fill="#f2a900"/></svg>';

function renderChrome() {
  const isSample = D.meta.dataSource === 'sample';
  $('#topbar').innerHTML = `<a class="brand" href="#/">${logo}BeePath</a><nav class="nav" aria-label="Main"><a href="#/">Roles</a><a href="#/archive">Archive</a><a href="#/me">My progress</a></nav><span class="pill ${isSample ? '' : 'real'}">${esc(D.meta.label || D.meta.dataSource)}</span>`;
  $('#banner').innerHTML = isSample
    ? `<p class="banner"><strong>Prototype on sample data.</strong> ${esc(D.meta.notice || '')}</p>` : '';
  $('#footer').innerHTML = `
    <p>Student prototype for STACK 2026. Not an official Binus system.</p>
    <p>No login. Your progress and ratings stay in this browser. Ratings only change the ranking on this device until the shared backend is built.</p>
    <p><button type="button" data-action="export">Export my ratings (JSON)</button></p>`;
}

// ---------- home ----------
function renderHome() {
  const available = D.roles.filter((r) => r.status === 'available');
  const skillIds = new Set(available.flatMap((r) => r.skills.map((s) => s.id)));
  const mapped = new Set();
  for (const [skillId, list] of D.skillCerts) if (skillIds.has(skillId)) list.forEach((e) => mapped.add(e.cert.id));
  const sampleWord = D.meta.dataSource === 'sample' ? 'sample ' : '';

  $('#main').innerHTML = `
    <div class="wrap">
      <section class="hero">
        <h1>What role do you want to work toward?</h1>
        <p>Pick a role, follow its skill path, and see a short list of certificates worth your time at each step.</p>
      </section>
      <ul class="role-grid">
        ${D.roles.map((r) => r.status === 'available'
          ? `<li><a class="role-card" href="${roleHref(r.id)}"><span class="icon" aria-hidden="true">${esc(r.icon)}</span><h2>${esc(r.name)}</h2><p>${esc(r.tagline)}</p><span class="tag">${r.skills.length} skills · Start path</span></a></li>`
          : `<li><div class="role-card soon" aria-disabled="true"><span class="icon" aria-hidden="true">${esc(r.icon)}</span><h2>${esc(r.name)}</h2><p>${esc(r.tagline)}</p><span class="tag">Coming soon</span></div></li>`).join('')}
      </ul>
      <p class="archive-note">The ${sampleWord}archive has ${D.certs.length} entries. ${mapped.size} of them are matched to a skill in the available roles, so you see those instead of scrolling the whole list. <a href="#/archive">Browse the whole archive with filters</a>.</p>
    </div>`;
  document.title = 'BeePath';
}

// ---------- role page ----------
const STEP = 148, TOP = 58, W = 360, AMP = [0, 62, 92, 62, 0, -62, -92, -62];
const pos = (i) => ({ x: W / 2 + AMP[i % AMP.length], y: TOP + i * STEP });

function pathSvg(skills, statuses) {
  let segs = '';
  for (let i = 0; i < skills.length - 1; i++) {
    const a = pos(i), b = pos(i + 1);
    const d = `M${a.x} ${a.y} C${a.x} ${a.y + STEP * 0.55}, ${b.x} ${b.y - STEP * 0.55}, ${b.x} ${b.y}`;
    segs += `<path class="trail ${statuses[i] === 'done' ? 'done' : ''}" d="${d}"/>`;
  }
  const h = TOP * 2 + (skills.length - 1) * STEP;
  return `<svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" aria-hidden="true">${segs}</svg>`;
}

function renderRole(role, skillId) {
  const skills = role.skills;
  const statuses = skills.map((s) => store.getStatus(role.id, s.id));
  const done = statuses.filter((s) => s === 'done').length;
  const doing = statuses.filter((s) => s === 'doing').length;
  const nextIdx = statuses.findIndex((s) => s !== 'done');
  const selected = skills.find((s) => s.id === skillId) || null;
  const height = TOP * 2 + (skills.length - 1) * STEP;

  const nodes = skills.map((s, i) => {
    const p = pos(i), st = statuses[i];
    const n = (D.skillCerts.get(s.id) || []).length;
    const glyph = st === 'done' ? '✓' : i + 1;
    const cls = [st, i === nextIdx ? 'next' : '', s.id === skillId ? 'selected' : ''].join(' ');
    const stLabel = { todo: 'not started', doing: 'in progress', done: 'done' }[st];
    return `<a class="node ${cls}" href="${roleHref(role.id, s.id)}" style="left:${(p.x / W) * 100}%;top:${p.y - 44}px" aria-label="${esc(s.name)}, ${n} certificates, ${stLabel}"${s.id === skillId ? ' aria-current="true"' : ''}>
      <span class="hex"><span>${glyph}</span></span><span class="label">${esc(s.name)}</span></a>`;
  }).join('');

  $('#main').innerHTML = `
    <div class="wrap">
      <div class="role-head">
        <a class="back" href="#/">← All roles</a>
        <h1>${esc(role.name)}</h1>
        <p class="tagline">${esc(role.tagline)}</p>
        <div class="progress">
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${skills.length}" aria-valuenow="${done}" aria-label="Skills covered"><span style="width:${(done / skills.length) * 100}%"></span></div>
          <p><strong>You've covered ${done} of ${skills.length} skills</strong>${doing ? ` · ${doing} in progress` : ''}</p>
          ${nextIdx >= 0 ? `<p class="next"><a class="btn ghost" href="${roleHref(role.id, skills[nextIdx].id)}">Next up: ${esc(skills[nextIdx].name)}</a></p>` : '<p class="next">Every skill on this path is marked done.</p>'}
        </div>
      </div>
      <div class="role-layout">
        <div class="path" style="height:${height}px">${pathSvg(skills, statuses)}${nodes}</div>
        <a class="backdrop ${selected ? 'open' : ''}" href="${roleHref(role.id)}" aria-label="Close skill details"></a>
        <aside class="panel ${selected ? 'open' : ''}" aria-label="Skill details">${selected ? '<div class="panel-body" id="panel-body"></div>' : '<p class="placeholder">Select a skill on the path to see free learning resources and the certificates ranked for it.</p>'}</aside>
      </div>
    </div>`;

  if (selected) { fillPanel(role, selected); }
  document.title = `${role.name} · BeePath`;
}

function fillPanel(role, skill) {
  const st = store.getStatus(role.id, skill.id);
  const idx = role.skills.findIndex((s) => s.id === skill.id);
  const prereq = (skill.prerequisites || []).map((id) => role.skills.find((s) => s.id === id)?.name).filter(Boolean);
  const resources = (skill.resources || []).map((r) => ({ ...r, url: safeUrl(r.url) })).filter((r) => r.url);

  $('#panel-body').innerHTML = `
    <a class="btn ghost close" href="${roleHref(role.id)}">Close</a>
    <h2 id="panel-title" tabindex="-1">${esc(skill.name)}</h2>
    <p class="desc">${esc(skill.description)}</p>
    ${prereq.length ? `<p class="recap">Works best after: ${prereq.map(esc).join(', ')}</p>` : ''}
    <div class="seg" role="group" aria-label="Your progress on this skill">
      ${[['todo', 'Not started'], ['doing', 'In progress'], ['done', 'Done']].map(([v, l]) => `<button type="button" data-action="status" data-status="${v}" aria-pressed="${st === v}">${l}</button>`).join('')}
    </div>
    <h3>Free ways to learn it</h3>
    ${resources.length ? `<ul class="resources">${resources.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}<small>${esc(r.type || 'link')} ↗</small></a></li>`).join('')}</ul>` : '<p class="empty">No free resources listed for this skill yet.</p>'}
    <h3>Certificates for this skill</h3>
    <div class="filters">
      <label><input type="checkbox" data-filter="free" ${ui.freeOnly ? 'checked' : ''}> Free only</label>
      <label>Time <select data-filter="hours" aria-label="Maximum time">
        ${[[0, 'Any'], [5, 'Up to 5 h'], [10, 'Up to 10 h'], [20, 'Up to 20 h']].map(([v, l]) => `<option value="${v}" ${ui.maxHours === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
    </div>
    <div id="certs"></div>`;
  renderCerts(skill);
  if (idx >= 0) $('#panel-title')?.focus({ preventScroll: true });
}

function renderCerts(skill) {
  const entries = D.skillCerts.get(skill.id) || [];
  const agg = aggregateRatings(D.seedRatings, store.getMyRatings());
  const ranked = rankCertificates(entries, agg, { freeOnly: ui.freeOnly, maxHours: ui.maxHours }, CONFIG.RANK);
  const shown = ui.showAll ? ranked : ranked.slice(0, CONFIG.TOP_N);
  const mine = store.getMyRatings();

  let html;
  if (!entries.length) {
    html = '<p class="empty">No certificates are matched to this skill yet.</p>';
  } else if (!ranked.length) {
    html = '<p class="empty">No certificates match these filters. Clear a filter to see all of them.</p>';
  } else {
    html = `<ol class="certs">${shown.map((e, i) => certCard(e, i + 1, skill, mine)).join('')}</ol>`;
    if (ranked.length > CONFIG.TOP_N) {
      html += `<p class="more"><button type="button" class="btn ghost" data-action="more">${ui.showAll ? 'Show fewer' : `Show ${ranked.length - CONFIG.TOP_N} more`}</button></p>`;
    }
  }
  $('#certs').innerHTML = html;
}

function completeActions(c, skillId) {
  const done = store.getCompleted()[c.id];
  return done
    ? `<span class="badge done">Completed ✓</span><a class="btn ghost" href="${esc(linkedinUrl(c, done.completedOn))}" target="_blank" rel="noopener noreferrer">Add to LinkedIn ↗</a>`
    : `<button type="button" class="btn ghost" data-action="complete" data-cert="${esc(c.id)}" data-skill="${esc(skillId || '')}">Mark as completed</button>`;
}

function certCard(e, rank, skill, mine) {
  const c = e.cert, key = `${c.id}|${skill.id}`, sum = ratingSummary(e.agg), my = mine[key];
  const url = safeUrl(c.url);
  const ratingLine = sum.n
    ? `<span aria-label="${sum.avg.toFixed(1)} out of 5">${stars(sum.avg)}</span> ${sum.avg.toFixed(1)}${sum.relevantPct != null ? ` · ${sum.relevantPct}% found it relevant` : ''} · ${sum.n} rating${sum.n > 1 ? 's' : ''}`
    : 'Not rated yet';
  const editing = ui.rate && ui.rate.key === key;
  return `<li class="cert">
    <span class="rank" aria-label="Rank ${rank}">${rank}</span>
    <div>
      <h4>${esc(c.title)}</h4>
      <p class="meta">${esc(c.issuer || 'Issuer not listed')}
        ${c.sample ? '<span class="badge sample">Sample</span>' : ''}
        ${c.providerType === 'campus' ? '<span class="badge">Campus</span>' : ''}
        <span class="badge match">${matchLabel(e.relevance)}</span></p>
      <ul class="facts"><li>${esc(fmtPrice(c.price))}</li><li>${esc(fmtHours(c.hours))}</li>${c.level ? `<li>${esc(c.level)}</li>` : ''}</ul>
      <p class="rating-line">${ratingLine}</p>
      ${my ? `<p class="rating-line"><strong>Your rating:</strong> ${stars(my.stars)} · ${my.relevant ? 'relevant' : 'not relevant'}</p>` : ''}
      <div class="cert-actions">
        ${url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View certificate ↗</a>` : ''}
        ${editing ? '' : `<button type="button" class="btn ghost" data-action="rate-open" data-key="${esc(key)}">${my ? 'Change my rating' : 'I completed this: rate it'}</button>`}
        ${completeActions(c, skill.id)}
      </div>
      ${editing ? rateForm() : ''}
    </div></li>`;
}

function rateForm() {
  const r = ui.rate, ready = r.stars > 0 && typeof r.relevant === 'boolean';
  return `<div class="rate-form">
    <div><strong>How was it overall?</strong>
      <div class="stars" role="group" aria-label="Star rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="star" data-value="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${r.stars === n}" class="${n <= r.stars ? 'on' : ''}">★</button>`).join('')}</div></div>
    <div><strong>Was it relevant to this skill?</strong>
      <div class="row">
        <button type="button" class="btn ghost" data-action="rel" data-value="yes" aria-pressed="${r.relevant === true}" ${r.relevant === true ? 'style="border-color:var(--ink)"' : ''}>Yes</button>
        <button type="button" class="btn ghost" data-action="rel" data-value="no" aria-pressed="${r.relevant === false}" ${r.relevant === false ? 'style="border-color:var(--ink)"' : ''}>No</button>
      </div></div>
    <div class="row"><button type="button" class="btn" data-action="rate-save" ${ready ? '' : 'disabled'}>Save rating</button><button type="button" class="btn ghost" data-action="rate-cancel">Cancel</button></div>
    <p class="fine">Anonymous. Saved on this device only in the prototype.</p></div>`;
}

// ---------- helpers for the new pages ----------
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

// ---------- archive: the whole list, filtered by career relevance ----------
function certSkillIndex() {
  const idx = new Map(); // certId -> [{ skillId, name, roleName, relevance }]
  for (const [skillId, list] of D.skillCerts) {
    const sk = D.skillById.get(skillId); if (!sk) continue;
    const role = D.roleById.get(sk.roleId);
    for (const e of list) {
      if (!idx.has(e.cert.id)) idx.set(e.cert.id, []);
      idx.get(e.cert.id).push({ skillId, name: sk.name, roleName: role?.name || '', relevance: e.relevance });
    }
  }
  return idx;
}

function renderArchive() {
  const A = ui.arch;
  const roles = D.roles.filter((r) => r.status === 'available');
  const cats = [...new Set(D.certs.map((c) => c.category).filter(Boolean))].sort();
  $('#main').innerHTML = `
    <div class="wrap">
      <div class="role-head">
        <a class="back" href="#/">← All roles</a>
        <h1>Certificate archive</h1>
        <p class="tagline">Search all ${D.certs.length} entries. Pick a skill to filter by career relevance and rank by fit.</p>
      </div>
      <div class="filters arch-filters">
        <label>Search <input type="search" data-filter="a-q" value="${esc(A.q)}" placeholder="Title, issuer, topic" aria-label="Search certificates"></label>
        <label>Skill <select data-filter="a-skill" aria-label="Filter by skill">
          <option value="">Any skill</option>
          ${roles.map((r) => `<optgroup label="${esc(r.name)}">${r.skills.map((s) => `<option value="${esc(s.id)}" ${A.skill === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
        </select></label>
        <label>Category <select data-filter="a-cat" aria-label="Filter by category">
          <option value="">Any category</option>
          ${cats.map((c) => `<option value="${esc(c)}" ${A.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select></label>
        <label><input type="checkbox" data-filter="a-free" ${A.freeOnly ? 'checked' : ''}> Free only</label>
        <label>Time <select data-filter="a-hours" aria-label="Maximum time">
          ${[[0, 'Any'], [5, 'Up to 5 h'], [10, 'Up to 10 h'], [20, 'Up to 20 h']].map(([v, l]) => `<option value="${v}" ${A.maxHours === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <p class="arch-count" id="arch-count" aria-live="polite"></p>
      <div id="arch-list"></div>
    </div>`;
  renderArchiveList();
  document.title = 'Archive · BeePath';
}

function renderArchiveList() {
  const A = ui.arch, idx = certSkillIndex();
  const q = A.q.trim().toLowerCase();
  let rows;
  if (A.skill) {
    const agg = aggregateRatings(D.seedRatings, store.getMyRatings());
    rows = rankCertificates(D.skillCerts.get(A.skill) || [], agg, { freeOnly: A.freeOnly, maxHours: A.maxHours }, CONFIG.RANK)
      .map((e) => ({ cert: e.cert, relevance: e.relevance }));
  } else {
    rows = D.certs
      .filter((c) => (!A.freeOnly || c.price?.amount === 0) && (!A.maxHours || (typeof c.hours === 'number' && c.hours <= A.maxHours)))
      .map((c) => ({ cert: c, relevance: null }))
      .sort((a, b) => a.cert.title.localeCompare(b.cert.title));
  }
  rows = rows.filter(({ cert: c }) =>
    (!A.category || c.category === A.category) &&
    (!q || [c.title, c.issuer, c.category, c.description].some((t) => String(t || '').toLowerCase().includes(q))));

  const shown = rows.slice(0, A.limit);
  $('#arch-count').textContent = `Showing ${shown.length} of ${rows.length} matching entries${A.skill ? ', best fit first' : ''}.`;
  if (!rows.length) { $('#arch-list').innerHTML = '<p class="empty">Nothing matches these filters. Clear a filter to see more.</p>'; return; }

  $('#arch-list').innerHTML = `<ul class="certs plain">${shown.map(({ cert: c, relevance }) => {
    const sk = idx.get(c.id) || [];
    const url = safeUrl(c.url);
    return `<li class="cert plain"><div>
      <h4>${esc(c.title)}</h4>
      <p class="meta">${esc(c.issuer || 'Issuer not listed')}
        ${c.sample ? '<span class="badge sample">Sample</span>' : ''}
        ${c.providerType === 'campus' ? '<span class="badge">Campus</span>' : ''}
        ${c.category ? `<span class="badge">${esc(c.category)}</span>` : ''}
        ${relevance != null ? `<span class="badge match">${matchLabel(relevance)}</span>` : ''}</p>
      ${c.description ? `<p class="cdesc">${esc(c.description)}</p>` : ''}
      <ul class="facts"><li>${esc(fmtPrice(c.price))}</li><li>${esc(fmtHours(c.hours))}</li>${c.level ? `<li>${esc(c.level)}</li>` : ''}</ul>
      <p class="rating-line">${sk.length ? `Matched to: ${sk.map((x) => esc(x.name)).join(', ')}` : 'Not matched to a skill in the available roles'}</p>
      <div class="cert-actions">
        ${url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View certificate ↗</a>` : ''}
        ${completeActions(c, A.skill || sk[0]?.skillId)}
      </div></div></li>`;
  }).join('')}</ul>
  ${rows.length > shown.length ? `<p class="more"><button type="button" class="btn ghost" data-action="arch-more">Show ${Math.min(50, rows.length - shown.length)} more</button></p>` : ''}`;
}

// ---------- my progress: skill profile, certificate tracker, CV draft ----------
function renderMe() {
  const completedMap = store.getCompleted();
  const completed = Object.entries(completedMap)
    .map(([id, v]) => ({ cert: D.certById.get(id), ...v })).filter((x) => x.cert)
    .sort((a, b) => (b.completedOn || '').localeCompare(a.completedOn || ''));
  const completedIds = new Set(completed.map((x) => x.cert.id));
  const submitted = completed.filter((x) => x.submittedToBinus).length;

  const profile = D.roles.filter((r) => r.status === 'available').map((role) => {
    const rows = role.skills.map((s) => ({
      s, st: store.getStatus(role.id, s.id),
      viaCert: (D.skillCerts.get(s.id) || []).some((e) => completedIds.has(e.cert.id)),
    }));
    return { role, rows };
  });

  const profileHtml = profile.map(({ role, rows }) => {
    const done = rows.filter((r) => r.st === 'done'), doing = rows.filter((r) => r.st === 'doing'), todo = rows.filter((r) => r.st === 'todo');
    return `<div class="card">
      <h3>${esc(role.name)}</h3>
      <p><strong>${done.length} of ${rows.length} skills done</strong>${doing.length ? ` · ${doing.length} in progress` : ''} · <a href="${roleHref(role.id)}">Open path</a></p>
      ${done.length ? `<h4>Done</h4><ul class="chips">${done.map((r) => `<li>${esc(r.s.name)}<small>${r.viaCert ? 'certificate completed' : 'self-reported'}</small></li>`).join('')}</ul>` : '<p class="fine">No skills marked done yet.</p>'}
      ${doing.length ? `<h4>In progress</h4><ul class="chips">${doing.map((r) => `<li>${esc(r.s.name)}</li>`).join('')}</ul>` : ''}
      ${todo.length ? `<h4>Not covered yet</h4><ul class="chips muted">${todo.map((r) => `<li>${esc(r.s.name)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');

  const trackerHtml = completed.length ? `<ul class="tracker">${completed.map(({ cert: c, completedOn, submittedToBinus }) => {
    const url = safeUrl(c.url);
    return `<li class="card tcert">
      <div class="thead"><div><h4>${esc(c.title)}</h4><p class="meta">${esc(c.issuer || 'Issuer not listed')} ${c.sample ? '<span class="badge sample">Sample</span>' : ''}</p></div>
        <span class="badge ${submittedToBinus ? 'done' : ''}">${submittedToBinus ? 'In BeePath and Binus' : 'In BeePath only'}</span></div>
      <div class="trow">
        <label>Completed <input type="month" value="${esc(completedOn || '')}" data-action="cdate" data-cert="${esc(c.id)}"></label>
        <label class="check"><input type="checkbox" data-action="submitted" data-cert="${esc(c.id)}" ${submittedToBinus ? 'checked' : ''}> I have submitted it to Binus</label>
      </div>
      <div class="cert-actions">
        ${url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Go to provider page ↗</a>` : '<span class="fine">No provider link on record</span>'}
        <a class="btn ghost" href="${esc(linkedinUrl(c, completedOn))}" target="_blank" rel="noopener noreferrer">Add to LinkedIn ↗</a>
        <button type="button" class="btn ghost" data-action="copy-details" data-cert="${esc(c.id)}">Copy details</button>
        <button type="button" class="btn ghost" data-action="uncomplete" data-cert="${esc(c.id)}">Remove</button>
      </div></li>`;
  }).join('')}</ul>` : `<p class="empty">No completed certificates yet. Open a skill and press "Mark as completed" on a certificate, or <a href="#/archive">browse the archive</a>.</p>`;

  const cv = cvText({
    certs: completed.map((x) => ({ cert: x.cert, completedOn: x.completedOn })),
    skillGroups: profile.map(({ role, rows }) => ({ role: role.name, skills: rows.filter((r) => r.st === 'done').map((r) => r.s.name) })),
  });

  $('#main').innerHTML = `
    <div class="wrap">
      <div class="role-head">
        <a class="back" href="#/">← All roles</a>
        <h1>My progress</h1>
        <p class="tagline">What you have covered, which certificates you have completed, and a CV draft built from both. Stored in this browser only.</p>
      </div>

      <section class="block" aria-labelledby="h-profile">
        <h2 id="h-profile">Skill profile</h2>
        <p class="fine">Shows only what you marked. A certificate shows you completed a course, not how well you know the skill, so BeePath does not score it.</p>
        <div class="cards">${profileHtml}</div>
      </section>

      <section class="block" aria-labelledby="h-tracker">
        <h2 id="h-tracker">My certificates</h2>
        <p class="fine">${completed.length} in BeePath · ${submitted} marked as submitted to Binus · ${completed.length - submitted} not submitted yet. The Binus status is your own tick, because BeePath cannot see the campus system.</p>
        <p class="fine">Before submitting one to the campus app, have these ready: title, issuer, completion date, credential link or ID, and the certificate file. "Copy details" gives you the first four. The campus app decides its exact form.</p>
        ${trackerHtml}
      </section>

      <section class="block" aria-labelledby="h-cv">
        <h2 id="h-cv">CV draft</h2>
        <p class="fine">Plain text built from your completed certificates and the skills you marked done. Edit it, then paste it into your own CV and add your name, education and projects.</p>
        <textarea id="cv-text" class="cv-text" rows="10" aria-label="CV draft text" placeholder="Mark certificates as completed and skills as done to fill this in.">${esc(cv)}</textarea>
        <div class="cert-actions"><button type="button" class="btn" data-action="cv-copy">Copy</button><button type="button" class="btn ghost" data-action="cv-download">Download .txt</button></div>
      </section>
    </div>`;
  document.title = 'My progress · BeePath';
}

// ---------- actions ----------
function currentSkill() {
  const r = parseRoute();
  const role = D.roleById.get(r.roleId);
  return { role, skill: role?.skills.find((s) => s.id === r.skillId) || null };
}

function rerender(keepScroll = true) {
  const y = window.scrollY, panel = $('.panel'), py = panel ? panel.scrollTop : 0;
  render();
  if (keepScroll) { window.scrollTo(0, y); const p = $('.panel'); if (p) p.scrollTop = py; }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || !D) return;
  const a = el.dataset.action;
  const { role, skill } = currentSkill();

  if (a === 'export') {
    const blob = new Blob([JSON.stringify(store.exportRatings(D.dataset), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'beepath-my-ratings.json'; link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  if (a === 'complete') {
    store.setCompleted(el.dataset.cert, el.dataset.skill, thisMonth());
    rerender(); toast('Added to My progress');
    return;
  }
  if (a === 'uncomplete') { store.removeCompleted(el.dataset.cert); rerender(); toast('Removed from My progress'); return; }
  if (a === 'copy-details') {
    const c = D.certById.get(el.dataset.cert), v = store.getCompleted()[el.dataset.cert];
    if (c) copyText(detailsText(c, v?.completedOn)).then((ok) => toast(ok ? 'Details copied' : 'Could not copy. Select and copy it manually.'));
    return;
  }
  if (a === 'cv-copy') { copyText($('#cv-text').value).then((ok) => toast(ok ? 'CV text copied' : 'Could not copy. Select the text and copy it.')); return; }
  if (a === 'cv-download') {
    const blob = new Blob([$('#cv-text').value], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'beepath-cv-draft.txt'; link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  if (a === 'arch-more') { ui.arch.limit += 50; renderArchiveList(); return; }
  if (!role || !skill) return;
  if (a === 'status') {
    store.setStatus(role.id, skill.id, el.dataset.status);
    rerender();
    toast({ todo: 'Marked as not started', doing: 'Marked as in progress', done: 'Marked as done' }[el.dataset.status]);
  } else if (a === 'more') { ui.showAll = !ui.showAll; renderCerts(skill); }
  else if (a === 'rate-open') {
    const my = store.getMyRatings()[el.dataset.key];
    ui.rate = { key: el.dataset.key, stars: my?.stars || 0, relevant: my ? my.relevant : null };
    renderCerts(skill);
  } else if (a === 'star') { ui.rate.stars = Number(el.dataset.value); renderCerts(skill); }
  else if (a === 'rel') { ui.rate.relevant = el.dataset.value === 'yes'; renderCerts(skill); }
  else if (a === 'rate-cancel') { ui.rate = null; renderCerts(skill); }
  else if (a === 'rate-save') {
    const [certId] = ui.rate.key.split('|');
    store.setMyRating(certId, skill.id, { stars: ui.rate.stars, relevant: ui.rate.relevant });
    ui.rate = null; renderCerts(skill);
    toast('Rating saved on this device');
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target, act = t.dataset?.action;
  if (D && act === 'submitted') { store.updateCompleted(t.dataset.cert, { submittedToBinus: t.checked }); rerender(); return; }
  if (D && act === 'cdate') { if (t.value) { store.updateCompleted(t.dataset.cert, { completedOn: t.value }); rerender(); } return; }
  const f = t.dataset?.filter;
  if (!f || !D) return;
  if (f.startsWith('a-')) {
    const A = ui.arch;
    if (f === 'a-skill') A.skill = t.value;
    if (f === 'a-cat') A.category = t.value;
    if (f === 'a-free') A.freeOnly = t.checked;
    if (f === 'a-hours') A.maxHours = Number(t.value);
    A.limit = 50; renderArchiveList();
    return;
  }
  if (f === 'free') ui.freeOnly = ev.target.checked;
  if (f === 'hours') ui.maxHours = Number(ev.target.value);
  const { skill } = currentSkill();
  if (skill) renderCerts(skill);
});

document.addEventListener('input', (ev) => {
  if (D && ev.target.dataset?.filter === 'a-q') { ui.arch.q = ev.target.value; ui.arch.limit = 50; renderArchiveList(); }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && D) {
    const r = parseRoute();
    if (r.name === 'role' && r.skillId) location.hash = roleHref(r.roleId);
  }
});

// ---------- boot ----------
function render() {
  const r = parseRoute();
  if (r.name === 'role') {
    const role = D.roleById.get(r.roleId);
    if (!role || role.status !== 'available') {
      $('#main').innerHTML = '<div class="state"><h1>That role isn\'t available yet</h1><p><a href="#/">Back to all roles</a></p></div>';
      return;
    }
    renderRole(role, r.skillId);
  } else if (r.name === 'archive') renderArchive();
  else if (r.name === 'me') renderMe();
  else renderHome();
  markNav();
}

function markNav() {
  const r = parseRoute();
  const target = r.name === 'archive' ? '#/archive' : r.name === 'me' ? '#/me' : '#/';
  document.querySelectorAll('.nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === target ? 'page' : 'false'));
}

function onRoute() {
  const r = parseRoute();
  const key = routeKey(r);
  const changedPage = key !== lastRoute;
  ui.showAll = false; ui.rate = null;
  lastRoute = key;
  if (changedPage) { render(); window.scrollTo(0, 0); } // new page: start at top
  else rerender(true);                                   // same role, different skill: keep scroll
}

async function boot() {
  try {
    D = await loadData();
  } catch (err) {
    const hint = location.protocol === 'file:' ? ' Open the app through a local server (run <code>npm start</code>) instead of double-clicking index.html.' : '';
    $('#main').innerHTML = `<div class="state"><h1>BeePath couldn't load its data</h1><p>${esc(err.message)}.${hint}</p></div>`;
    return;
  }
  renderChrome();
  window.addEventListener('hashchange', onRoute);
  lastRoute = routeKey(parseRoute());
  render();
}
boot();
