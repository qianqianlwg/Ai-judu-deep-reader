import { Pool } from "pg";
import { buildPostgresSearchQuery, type PostgresSearchOptions, type PostgresSearchRow } from "./postgres-search";

let pool: Pool | undefined;
function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export async function searchPostgres(options: PostgresSearchOptions): Promise<PostgresSearchRow[]> {
  const query = buildPostgresSearchQuery(options);
  const result = await getPool().query<PostgresSearchRow>(query.text, query.values);
  return result.rows;
}

export async function getPostgresSearchIndexStatus(editionId: string): Promise<{ paragraphCount: number; indexedCount: number }> {
  const result = await getPool().query<{ paragraphCount: string | number; indexedCount: string | number }>(
    'SELECT COUNT(*)::int AS "paragraphCount", COUNT(embedding)::int AS "indexedCount" FROM reader_paragraph_embeddings WHERE edition_id = $1',
    [editionId],
  );
  const row = result.rows[0];
  return { paragraphCount: Number(row?.paragraphCount ?? 0), indexedCount: Number(row?.indexedCount ?? 0) };
}
