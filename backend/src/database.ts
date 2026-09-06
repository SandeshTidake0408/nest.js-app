import { Pool, PoolClient, QueryResultRow } from 'pg';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function oneOrNone<T extends QueryResultRow>(sql: string, params: unknown[] = [], client = pool): Promise<T | undefined> {
  return (await client.query<T>(sql, params)).rows[0];
}
