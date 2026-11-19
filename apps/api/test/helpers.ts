import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { totpAt } from '../src/auth/crypto';
import { migrate } from '../src/database/migrate';
import { seed } from '../src/database/seed';

// Çelësa testues (jo sekrete reale). Në Production çelësat vijnë nga KMS.
process.env.SECRET_KEYS = `k1:${Buffer.alloc(32, 1).toString('base64')},k2:${Buffer.alloc(32, 2).toString('base64')}`;
process.env.SECRET_ACTIVE_KEY_ID = 'k1';
process.env.LOGIN_IP_LIMIT = '1000';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/temaj_erp_test';
export const ADMIN = { email: 'admin@temaj.test', password: 'Admin-Test-Fjalekalim-1' };
export const APPROVER = { email: 'aprovues@temaj.test', password: 'Aprovues-Test-Fjalekalim-1' };

/** Databazë e pastër për çdo skedar testesh: skema fshihet, migrimet dhe seed-i ekzekutohen nga e para. */
export async function freshDatabase(): Promise<Pool> {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  
  await migrate(pool);
  await seed(pool, { adminPassword: ADMIN.password, approverPassword: APPROVER.password });
  return pool;
}

export async function createApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = TEST_DB_URL;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

export async function login(app: INestApplication, email: string, password: string, totp?: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password, totp });
  if (res.status !== 200) throw new Error(`Login dështoi për ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

/** Aktivizon 2FA dhe kthen një sesion të ri me 2FA të kaluar. */
export async function loginWithMfa(app: INestApplication, email: string, password: string): Promise<{ token: string; secret: string }> {
  const t = await login(app, email, password);
  const setup = await request(app.getHttpServer()).post('/api/auth/mfa/setup').set('Authorization', `Bearer ${t}`);
  const secret = setup.body.secret as string;
  const en = await request(app.getHttpServer()).post('/api/auth/mfa/enable').set('Authorization', `Bearer ${t}`).send({ code: totpAt(secret, Date.now()) });
  if (en.status !== 204) throw new Error(`MFA enable dështoi: ${JSON.stringify(en.body)}`);
  const token = await login(app, email, password, totpAt(secret, Date.now()));
  return { token, secret };
}
