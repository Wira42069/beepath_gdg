// Server-side data access for pages and API routes: the configured dataset on the shared client.
import { datasetName } from './config';
import { getDb } from './db';
import * as repo from './repo';
import type { DatasetInfo } from './types';

export class DatasetMissingError extends Error {
  dataset: string;
  constructor(dataset: string) {
    super(`The "${dataset}" dataset is not in the database yet. Run: npm run db:seed -- --dataset ${dataset}`);
    this.dataset = dataset;
  }
}

/** The configured dataset plus a client, or a DatasetMissingError the pages turn into setup help. */
export async function current(): Promise<{ db: Awaited<ReturnType<typeof getDb>>; dataset: string; info: DatasetInfo }> {
  const dataset = datasetName();
  const db = await getDb();
  const info = await repo.getDatasetInfo(db, dataset);
  if (!info) throw new DatasetMissingError(dataset);
  return { db, dataset, info };
}
