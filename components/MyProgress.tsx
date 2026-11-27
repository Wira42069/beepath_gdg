'use client';
// My progress: skill profile, certificate tracker and CV draft. Everything here comes from this
// browser (progress, completed certificates); certificate details are fetched by id.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { cvText, detailsText, linkedinUrl } from '@/lib/cv';
import { issuerLine, safeUrl } from '@/lib/format';
import { removeCompleted, statusOf, updateCompleted, useCompleted, useProgress } from '@/lib/store';
import type { Certificate, Role } from '@/lib/types';
import { copyText, download, useToast } from './Toast';

type CertWithSkills = Certificate & { skills: string[] };

export function MyProgress({ roles }: { roles: Role[] }) {
  const toast = useToast();
  const progress = useProgress();
  const completedMap = useCompleted();
  const [certs, setCerts] = useState<Record<string, CertWithSkills>>({});
  const [loadError, setLoadError] = useState(false);
  const ids = Object.keys(completedMap).sort();
  const idKey = ids.join(',');

  useEffect(() => {
    const missing = idKey ? idKey.split(',').filter((id) => !certs[id]) : [];
    if (!missing.length) return;
    let cancelled = false;
    fetch(`/api/certificates?ids=${encodeURIComponent(missing.join(','))}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { certificates: CertWithSkills[] }) => {
        if (cancelled) return;
        setCerts((prev) => ({ ...prev, ...Object.fromEntries(body.certificates.map((c) => [c.id, c])) }));
        setLoadError(false);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const completed = useMemo(
    () => Object.entries(completedMap)
      .map(([id, v]) => ({ cert: certs[id], id, ...v }))
      .filter((x) => x.cert)
      .sort((a, b) => (b.completedOn || '').localeCompare(a.completedOn || '')),
    [completedMap, certs],
  );
  const completedSkillIds = new Set(completed.flatMap((x) => x.cert.skills));
  const submitted = completed.filter((x) => x.submittedToBinus).length;

  const profile = roles.map((role) => ({
    role,
    rows: role.skills.map((s) => ({ s, st: statusOf(progress, role.id, s.id), viaCert: completedSkillIds.has(s.id) })),
  }));

  const cv = cvText({
    certs: completed.map((x) => ({ cert: x.cert, completedOn: x.completedOn })),
    skillGroups: profile.map(({ role, rows }) => ({ role: role.name, skills: rows.filter((r) => r.st === 'done').map((r) => r.s.name) })),
  });
  const [cvDraft, setCvDraft] = useState<string | null>(null); // null = follow the generated text
  const cvValue = cvDraft ?? cv;

  return (
    <div className="wrap">
      <div className="role-head">
        <Link className="back" href="/">← All roles</Link>
        <h1>My progress</h1>
        <p className="tagline">What you have covered, which certificates you have completed, and a CV draft built from both. Stored in this browser only.</p>
      </div>

      <section className="block" aria-labelledby="h-profile">
        <h2 id="h-profile">Skill profile</h2>
        <p className="fine">Shows only what you marked. A certificate shows you completed a course, not how well you know the skill, so BeePath does not score it.</p>
        <div className="cards">
          {profile.map(({ role, rows }) => {
            const done = rows.filter((r) => r.st === 'done'), doing = rows.filter((r) => r.st === 'doing'), todo = rows.filter((r) => r.st === 'todo');
            return (
              <div className="card" key={role.id}>
                <h3>{role.name}</h3>
                <p><strong>{done.length} of {rows.length} skills done</strong>{doing.length ? ` · ${doing.length} in progress` : ''} · <Link href={`/role/${role.id}`}>Open path</Link></p>
                {done.length ? (
                  <><h4>Done</h4><ul className="chips">{done.map((r) => <li key={r.s.id}>{r.s.name}<small>{r.viaCert ? 'certificate completed' : 'self-reported'}</small></li>)}</ul></>
                ) : <p className="fine">No skills marked done yet.</p>}
                {doing.length > 0 && <><h4>In progress</h4><ul className="chips">{doing.map((r) => <li key={r.s.id}>{r.s.name}</li>)}</ul></>}
                {todo.length > 0 && <><h4>Not covered yet</h4><ul className="chips muted">{todo.map((r) => <li key={r.s.id}>{r.s.name}</li>)}</ul></>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="block" aria-labelledby="h-tracker">
        <h2 id="h-tracker">My certificates</h2>
        <p className="fine">
          {completed.length} in BeePath · {submitted} marked as submitted to Binus · {completed.length - submitted} not submitted yet. The Binus status is your own tick, because BeePath cannot see the campus system.
        </p>
        <p className="fine">
          To submit one, open the Binus certification app, search the certificate&apos;s archive code, and upload your certificate file or link. &quot;Copy details&quot; gives you the title, issuer, code and completion month.
        </p>
        {loadError && <p className="empty">Could not load your certificates from the server. They are still saved in this browser; reload to try again.</p>}
        {completed.length ? (
          <ul className="tracker">
            {completed.map(({ cert: c, completedOn, submittedToBinus }) => {
              const url = safeUrl(c.url);
              return (
                <li className="card tcert" key={c.id}>
                  <div className="thead">
                    <div>
                      <h4>{c.title}</h4>
                      <p className="meta">{issuerLine(c)} {c.sample && <span className="badge sample">Sample</span>}</p>
                      {c.code && <p className="submit-hint">Binus archive code <span className="badge code">{c.code}</span></p>}
                    </div>
                    <span className={`badge${submittedToBinus ? ' done' : ''}`}>{submittedToBinus ? 'In BeePath and Binus' : 'In BeePath only'}</span>
                  </div>
                  <div className="trow">
                    <label>Completed{' '}
                      <input type="month" value={completedOn || ''} onChange={(e) => { if (e.target.value) updateCompleted(c.id, { completedOn: e.target.value }); }} />
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={submittedToBinus} onChange={(e) => updateCompleted(c.id, { submittedToBinus: e.target.checked })} /> I have submitted it to Binus
                    </label>
                  </div>
                  <div className="cert-actions">
                    {url ? <a className="btn ghost" href={url} target="_blank" rel="noopener noreferrer">Go to provider page ↗</a> : <span className="fine">No provider link on record</span>}
                    <a className="btn ghost" href={linkedinUrl(c, completedOn)} target="_blank" rel="noopener noreferrer">Add to LinkedIn ↗</a>
                    <button type="button" className="btn ghost" onClick={() => copyText(detailsText(c, completedOn)).then((ok) => toast(ok ? 'Details copied' : 'Could not copy. Select and copy it manually.'))}>Copy details</button>
                    <button type="button" className="btn ghost" onClick={() => { removeCompleted(c.id); toast('Removed from My progress'); }}>Remove</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : ids.length && !loadError ? (
          <p className="empty">Loading your certificates…</p>
        ) : (
          <p className="empty">No completed certificates yet. Open a skill and press &quot;Mark as completed&quot; on a certificate, or <Link href="/archive">browse the archive</Link>.</p>
        )}
      </section>

      <section className="block" aria-labelledby="h-cv">
        <h2 id="h-cv">CV draft</h2>
        <p className="fine">Plain text built from your completed certificates and the skills you marked done. Edit it, then paste it into your own CV and add your name, education and projects.</p>
        <textarea id="cv-text" className="cv-text" rows={10} aria-label="CV draft text" placeholder="Mark certificates as completed and skills as done to fill this in." value={cvValue} onChange={(e) => setCvDraft(e.target.value)} />
        <div className="cert-actions">
          <button type="button" className="btn" onClick={() => copyText(cvValue).then((ok) => toast(ok ? 'CV text copied' : 'Could not copy. Select the text and copy it.'))}>Copy</button>
          <button type="button" className="btn ghost" onClick={() => download('beepath-cv-draft.txt', cvValue)}>Download .txt</button>
          {cvDraft != null && <button type="button" className="btn ghost" onClick={() => setCvDraft(null)}>Reset to generated text</button>}
        </div>
      </section>
    </div>
  );
}
