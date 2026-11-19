import { createPool } from './db';
import { seed } from './seed';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const approverPassword = process.env.SEED_APPROVER_PASSWORD;
  if (!url || !adminPassword || !approverPassword) {
    throw new Error('Vendosni DATABASE_URL, SEED_ADMIN_PASSWORD dhe SEED_APPROVER_PASSWORD (min. 12 karaktere)');
  }
  const pool = createPool(url);
  try {
    await seed(pool, { adminPassword, approverPassword, demoPassword: process.env.SEED_DEMO_PASSWORD });
    console.log(`Të dhënat sintetike u ngarkuan: admin@temaj.test, aprovues@temaj.test${process.env.SEED_DEMO_PASSWORD ? ', demo@temaj.test' : ''}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
