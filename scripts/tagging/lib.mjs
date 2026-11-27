// Offline LLM tagging, the pure parts (no network, no files): prompt, response schema,
// validation and merging. scripts/tag-gemini.mjs does the I/O. Tested in tests/app/tagging.test.ts.
import crypto from 'node:crypto';

// Bump when the prompt or schema changes in a way that should re-tag cached certificates.
export const PROMPT_VERSION = 2;
export const MIN_RELEVANCE = 0.5;
export const MAX_SKILLS = 3;
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Unknown'];

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Skills the model may choose from: every skill of every available role. */
export function allowedSkills(roles) {
  return roles
    .filter((r) => r.status === 'available')
    .flatMap((r) => r.skills.map((s) => ({ id: s.id, name: s.name, role: r.name, description: s.description })));
}

/** Stable fingerprint of what the model sees for one certificate (so edits trigger a re-tag). */
export function inputHash(cert, skillIds, categories) {
  const text = JSON.stringify([PROMPT_VERSION, cert.title, cert.issuer, cert.institution, cert.description, cert.outcomes, skillIds, categories]);
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

export function systemPrompt(skills, categories) {
  const skillLines = skills.map((s) => `- ${s.id}: ${s.name} (${s.role}). ${s.description}`).join('\n');
  return `You tag entries from a university's certificate archive for BeePath, a career-path app for undergraduate students who want tech careers.
The archive is uncurated: it mixes tech certifications with unrelated ones (construction, import procedures, music rights, and so on). Entries are in English or Indonesian.

For every certificate, decide:
1. category: exactly one from the allowed list.
2. careerRelevant: true only if the certificate would genuinely help a student toward at least one of these roles: Frontend Developer, Backend Developer, Data Analyst, UI/UX Designer, Cybersecurity Analyst. General office skills, soft skills, languages and unrelated fields are false.
3. skills: up to ${MAX_SKILLS} skills from the allowed list that the certificate trains, each with a relevance score:
   0.9-1.0 = the certificate is mainly about this skill;
   0.7-0.89 = covers a substantial part of it;
   0.5-0.69 = touches it in a useful way.
   Leave skills empty when careerRelevant is false or nothing fits at 0.5 or above. Never use a skill id that is not in the list.
4. level: Beginner, Intermediate or Advanced if the text makes it clear, otherwise Unknown.
5. reason: one short sentence (max 25 words) explaining the decision, in English.

Judge only from the given text. Do not guess facts that are not there. A generic title with no description should get modest relevance.

Allowed categories: ${categories.join('; ')}

Allowed skills:
${skillLines}`;
}

export function userPrompt(batch) {
  const items = batch.map((c) => ({
    id: c.id,
    title: c.title,
    issuer: c.issuer ?? undefined,
    institution: c.institution && c.institution !== c.issuer ? c.institution : undefined,
    description: c.description ? clip(c.description, 700) : undefined,
    learningOutcomes: c.outcomes ? clip(c.outcomes, 350) : undefined,
    duration: c.durationText ?? (c.hours ? `${c.hours} hours` : undefined),
  }));
  return `Tag these ${items.length} certificates. Return one result per id, in any order.\n\n${JSON.stringify(items, null, 1)}`;
}

/** JSON Schema for the response. Enums keep the model inside the fixed category and skill lists. */
export function responseSchema(skillIds, categories) {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            category: { type: 'string', enum: categories },
            careerRelevant: { type: 'boolean' },
            level: { type: 'string', enum: LEVELS },
            skills: {
              type: 'array',
              maxItems: MAX_SKILLS,
              items: {
                type: 'object',
                properties: {
                  skillId: { type: 'string', enum: skillIds },
                  relevance: { type: 'number', minimum: 0, maximum: 1 },
                },
                required: ['skillId', 'relevance'],
              },
            },
            reason: { type: 'string' },
          },
          required: ['id', 'category', 'careerRelevant', 'level', 'skills', 'reason'],
        },
      },
    },
    required: ['results'],
  };
}

/**
 * Checks the model's answer against the batch and the fixed lists. Returns clean tags keyed by id
 * plus the ids that are missing or invalid (to retry). Never trusts the model's output shape.
 */
export function validateResults(raw, batch, skillIds, categories) {
  const want = new Set(batch.map((c) => c.id));
  const skillSet = new Set(skillIds);
  const catSet = new Set(categories);
  const tags = new Map();
  const problems = [];
  const results = Array.isArray(raw?.results) ? raw.results : [];
  for (const r of results) {
    if (!r || typeof r !== 'object' || !want.has(r.id) || tags.has(r.id)) continue;
    if (!catSet.has(r.category) || typeof r.careerRelevant !== 'boolean') {
      problems.push(`${r.id}: bad category or careerRelevant`);
      continue;
    }
    const seen = new Set();
    const skills = (Array.isArray(r.skills) ? r.skills : [])
      .filter((s) => s && skillSet.has(s.skillId) && typeof s.relevance === 'number' && Number.isFinite(s.relevance))
      .map((s) => ({ skillId: s.skillId, relevance: Math.round(Math.min(1, Math.max(0, s.relevance)) * 100) / 100 }))
      .filter((s) => s.relevance >= MIN_RELEVANCE && !seen.has(s.skillId) && seen.add(s.skillId))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_SKILLS);
    tags.set(r.id, {
      category: r.category,
      careerRelevant: r.careerRelevant,
      level: LEVELS.includes(r.level) && r.level !== 'Unknown' ? r.level : null,
      skills: r.careerRelevant ? skills : [],
      reason: String(r.reason ?? '').slice(0, 300),
    });
  }
  const missing = [...want].filter((id) => !tags.has(id));
  return { tags, missing, problems };
}

/**
 * Applies tags to certificates and builds the mapping list.
 * Hand-made mappings (method "manual") always win: they are kept as they are, and the model's
 * suggestion for the same certificate-skill pair is dropped. Keyword and old LLM rows are replaced.
 */
export function applyTags(certs, oldMappings, tagsById) {
  const manual = oldMappings.filter((m) => m.method === 'manual');
  const manualPairs = new Set(manual.map((m) => `${m.certificateId}|${m.skillId}`));
  const outCerts = certs.map((c) => {
    const t = tagsById.get(c.id);
    if (!t) return c;
    return { ...c, category: t.category, careerRelevant: t.careerRelevant, level: c.level ?? t.level ?? null };
  });
  const llm = [];
  for (const c of certs) {
    const t = tagsById.get(c.id);
    if (!t) continue;
    for (const s of t.skills) {
      if (!manualPairs.has(`${c.id}|${s.skillId}`)) llm.push({ certificateId: c.id, skillId: s.skillId, relevance: s.relevance, method: 'llm' });
    }
  }
  // Certificates the model has not seen yet keep their keyword suggestions.
  const untagged = oldMappings.filter((m) => m.method !== 'manual' && !tagsById.has(m.certificateId));
  return { certs: outCerts, mappings: [...manual, ...untagged, ...llm] };
}

/** Deterministic pseudo-random sample for the human spot-check (same seed -> same rows). */
export function reviewSample(ids, fraction = 0.1, min = 30, seed = 'beepath') {
  const score = (id) => crypto.createHash('sha1').update(`${seed}:${id}`).digest().readUInt32BE(0);
  const n = Math.min(ids.length, Math.max(min, Math.ceil(ids.length * fraction)));
  return [...ids].sort((a, b) => score(a) - score(b)).slice(0, n);
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
