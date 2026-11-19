import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Ekzekuton migrimet SQL sipas radhës. Çdo migrim ruhet me checksum;
 * nëse një migrim i aplikuar ndryshohet më vonë, procesi ndalon.
 */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await pool.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name = $1', [file]);
    const row = existing.rows[0];
    if (row) {
      if (row.checksum !== checksum) throw new Error(`Migrimi ${file} është ndryshuar pas aplikimit (checksum mismatch)`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}
