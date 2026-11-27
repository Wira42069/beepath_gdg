// Shapes shared by the server (database) and the browser.

export type Resource = { title: string; url: string; type?: string };

export type Skill = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  prerequisites?: string[];
  resources?: Resource[];
};

export type Role = {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  status: 'available' | 'coming_soon';
  /** Draft skill trees the team has not signed off yet. */
  draft?: boolean;
  skills: Skill[];
};

export type Price = { amount: number; currency: string };

export type Certificate = {
  id: string;
  title: string;
  /** Code in the Binus certification app (e.g. CERT006132). Students search it there to submit. */
  code: string | null;
  issuer: string | null;
  institution: string | null;
  category: string | null;
  description: string | null;
  outcomes: string | null;
  creditEarning: string | null;
  providerType: 'campus' | 'third_party';
  url: string | null;
  price: Price | null;
  hours: number | null;
  /** Duration as the source wrote it ("2 Hari", "1 Bulan") when it is not in hours. */
  durationText: string | null;
  level: string | null;
  sample: boolean;
  /** Set by the offline LLM pass: false = not useful for any tech career path. null = not tagged. */
  careerRelevant: boolean | null;
};

export type MappingMethod = 'manual' | 'keyword' | 'llm';

/** A certificate placed on a skill, with the team's fixed relevance (0..1). */
export type SkillEntry = { cert: Certificate; skillId: string; relevance: number; method: MappingMethod };

export type RatingAgg = { n: number; sum: number; relYes: number; relN: number };

export type DatasetMeta = {
  dataSource: string;
  label: string;
  notice?: string;
  importedAt?: string;
  counts?: Record<string, number>;
};

export type DatasetInfo = {
  name: string;
  meta: DatasetMeta;
  isSample: boolean;
  certificates: number;
  /** Whether any certificate has a price / hours. Filters that can't match anything are hidden. */
  hasPrices: boolean;
  hasHours: boolean;
  /** Whether the LLM pass has marked unrelated entries. */
  hasRelevanceTags: boolean;
};
