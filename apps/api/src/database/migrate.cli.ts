import { createPool } from './db';
import { migrate } from './migrate';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL mungon');
  const pool = createPool(url);
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Migrime të aplikuara: ${applied.join(', ')}` : 'Databaza është e përditësuar.');
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
