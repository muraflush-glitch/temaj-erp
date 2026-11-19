import { Pool, PoolClient, QueryResultRow } from 'pg';

export type Db = Pool;
export type Tx = PoolClient;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

/**
 * Transaksion i shkurtër ACID. Mos e mbaj hapur gjatë thirrjeve të jashtme
 * (gateway, email, fiskalizim) — këto shkojnë përmes outbox-it në fazat e ardhshme.
 */
export async function withTransaction<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(q: Pool | Tx, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const res = await q.query<T>(sql, params);
  return res.rows[0];
}
