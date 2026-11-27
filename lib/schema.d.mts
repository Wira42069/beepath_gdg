import type { Client } from '@libsql/client';

export declare const SCHEMA: string[];
export declare function applySchema(client: Client): Promise<void>;
