import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import * as T from '../../scripts/tagging/lib.mjs';

const data = path.resolve(__dirname, '../../data');
const roles = JSON.parse(fs.readFileSync(path.join(data, 'roles.json'), 'utf8'));
const categories: string[] = JSON.parse(fs.readFileSync(path.join(data, 'categories.json'), 'utf8'));
const skills = T.allowedSkills(roles);
const skillIds = skills.map((s: { id: string }) => s.id);

const cert = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Cert ${id}`, issuer: 'X', institution: null, description: 'About SQL.', outcomes: null, ...over });

describe('tagging prompt and schema', () => {
  test('only skills of available roles are offered, and the schema pins them with enums', () => {
    expect(skillIds).toContain('fe-css');
    expect(skillIds).toContain('da-sql');
    const schema = T.responseSchema(skillIds, categories) as any;
    const item = schema.properties.results.items;
    expect(item.properties.category.enum).toEqual(categories);
    expect(item.properties.skills.items.properties.skillId.enum).toEqual(skillIds);
  });

  test('prompts carry the lists and trim long text', () => {
    const sys = T.systemPrompt(skills, categories);
    expect(sys).toContain('fe-css');
    expect(sys).toContain('Cybersecurity');
    const user = T.userPrompt([cert('a', { description: 'x'.repeat(2000) })]);
    expect(user.length).toBeLessThan(1200);
    expect(user).toContain('"id": "a"');
  });

  test('inputHash changes when the text or the skill list changes', () => {
    const h = T.inputHash(cert('a'), skillIds, categories);
    expect(T.inputHash(cert('a'), skillIds, categories)).toBe(h);
    expect(T.inputHash(cert('a', { description: 'Other' }), skillIds, categories)).not.toBe(h);
    expect(T.inputHash(cert('a'), skillIds.slice(1), categories)).not.toBe(h);
  });
});

describe('validating model answers', () => {
  const batch = [cert('a'), cert('b'), cert('c')];

  test('keeps good answers, cleans skills, and reports what is missing', () => {
    const raw = {
      results: [
        { id: 'a', category: 'Databases', careerRelevant: true, level: 'Beginner', reason: 'SQL basics',
          skills: [{ skillId: 'da-sql', relevance: 0.934 }, { skillId: 'be-sql', relevance: 1.7 }, { skillId: 'made-up', relevance: 0.9 },
            { skillId: 'da-sql', relevance: 0.6 }, { skillId: 'fe-css', relevance: 0.3 }] },
        { id: 'b', category: 'Not a category', careerRelevant: true, level: 'Beginner', skills: [], reason: '' },
        { id: 'zzz', category: 'Other', careerRelevant: false, level: 'Unknown', skills: [], reason: '' },
      ],
    };
    const { tags, missing, problems } = T.validateResults(raw, batch, skillIds, categories);
    expect(tags.get('a')).toEqual({
      category: 'Databases', careerRelevant: true, level: 'Beginner', reason: 'SQL basics',
      skills: [{ skillId: 'be-sql', relevance: 1 }, { skillId: 'da-sql', relevance: 0.93 }],
    });
    expect(missing.sort()).toEqual(['b', 'c']);
    expect(problems).toHaveLength(1);
  });

  test('irrelevant certificates never get skills; garbage is survived', () => {
    const { tags } = T.validateResults({ results: [{ id: 'a', category: 'Other', careerRelevant: false, level: 'Unknown', skills: [{ skillId: 'fe-css', relevance: 0.9 }], reason: 'Construction' }] }, batch, skillIds, categories);
    expect(tags.get('a')).toMatchObject({ careerRelevant: false, skills: [], level: null });
    expect(T.validateResults(null, batch, skillIds, categories).missing).toHaveLength(3);
    expect(T.validateResults({ results: 'nope' }, batch, skillIds, categories).missing).toHaveLength(3);
  });
});

describe('applying tags', () => {
  test('manual mappings win, keyword rows of tagged certificates are replaced, untagged ones kept', () => {
    const certs = [cert('a'), cert('b'), cert('c')];
    const old = [
      { certificateId: 'a', skillId: 'da-sql', relevance: 0.5, method: 'keyword' },
      { certificateId: 'a', skillId: 'be-sql', relevance: 0.8, method: 'manual' },
      { certificateId: 'c', skillId: 'fe-css', relevance: 0.5, method: 'keyword' },
    ];
    const tags = new Map([
      ['a', { category: 'Databases', careerRelevant: true, level: 'Beginner', reason: '', skills: [{ skillId: 'be-sql', relevance: 0.95 }, { skillId: 'da-sql', relevance: 0.9 }] }],
      ['b', { category: 'Other', careerRelevant: false, level: null, reason: '', skills: [] }],
    ]);
    const { certs: out, mappings } = T.applyTags(certs, old, tags);
    expect(out.find((c: any) => c.id === 'b')).toMatchObject({ careerRelevant: false, category: 'Other' });
    expect(out.find((c: any) => c.id === 'c')).not.toHaveProperty('careerRelevant');
    expect(mappings).toEqual([
      { certificateId: 'a', skillId: 'be-sql', relevance: 0.8, method: 'manual' },
      { certificateId: 'c', skillId: 'fe-css', relevance: 0.5, method: 'keyword' },
      { certificateId: 'a', skillId: 'da-sql', relevance: 0.9, method: 'llm' },
    ]);
  });

  test('the review sample is deterministic and sized sensibly', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id${i}`);
    const s1 = T.reviewSample(ids);
    expect(s1).toHaveLength(100);
    expect(T.reviewSample([...ids].reverse())).toEqual(s1);
    expect(T.reviewSample(ids.slice(0, 10))).toHaveLength(10);
  });
});
