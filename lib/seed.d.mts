import type { Client } from '@libsql/client';

export declare function seedDataset(
  client: Client,
  opts: { dataset: string; dataDir: string },
): Promise<{ dataset: string; certificates: number; mappings: number; skippedMappings: number; seedRatings: number; studentRatingsKept: number }>;
export declare function isSeeded(client: Client, dataset: string): Promise<boolean>;
