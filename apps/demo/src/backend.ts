// I gjithë "serveri" brenda shfletuesit: PostgreSQL i vërtetë (PGlite, WebAssembly) + të njëjtat shërbime dhe kontrollorë si API-ja.
// Asgjë nuk dërgohet në rrjet. Të dhënat jetojnë vetëm në memorien e kësaj skede.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PGlite } from '@electric-sql/pglite';
import { AccessController } from '../../api/src/access/access.controller';
import { AccessService } from '../../api/src/access/access.service';
import { ApprovalsController } from '../../api/src/approvals/approvals.controller';
import { ApprovalsService } from '../../api/src/approvals/approvals.service';
import { AuditController } from '../../api/src/audit/audit.controller';
import { AuditService } from '../../api/src/audit/audit.service';
import { AuthController } from '../../api/src/auth/auth.controller';
import { AuthService } from '../../api/src/auth/auth.service';
import { totpAt } from '../../api/src/auth/crypto';
import { PermissionService } from '../../api/src/auth/permission.service';
import { BillingController } from '../../api/src/billing/billing.controller';
import { BillingService } from '../../api/src/billing/billing.service';
import { CashController } from '../../api/src/cash/cash.controller';
import { CashService } from '../../api/src/cash/cash.service';
import { DomainError, forbidden, toHttpError } from '../../api/src/common/errors';
import { AuthUser } from '../../api/src/common/request';
import { seed } from '../../api/src/database/seed';
import { InventoryController } from '../../api/src/inventory/inventory.controller';
import { InventoryService } from '../../api/src/inventory/inventory.service';
import { LedgerController } from '../../api/src/ledger/ledger.controller';
import { LedgerService } from '../../api/src/ledger/ledger.service';
import { OrgController } from '../../api/src/org/org.controller';
import { PurchasingController } from '../../api/src/purchasing/purchasing.controller';
import { PurchasingService } from '../../api/src/purchasing/purchasing.service';
import { ReportsController } from '../../api/src/reports/reports.controller';
import { SalesController } from '../../api/src/sales/sales.controller';
import { SalesService } from '../../api/src/sales/sales.service';
import { ParseIntPipe, ParamDef, RouteDef } from '../shims/nest-common';
import { MIGRATIONS } from './migrations.gen';

export const DEMO = { email: 'demo@temaj.test', password: 'Demo-Prove-Temaj-2026' };
const APPROVER = { email: 'aprovues@temaj.test', password: 'Aprovues-Prove-Temaj-2026' };
const ADMIN_PASSWORD = 'Admin-Prove-Temaj-2026';
const EXT_HOST = 'https://temaj-prove.invalid/';

const b64 = (s: string): Uint8Array => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

interface Route { method: string; parts: string[]; ctrl: any; handler: string }
let routes: Route[] = [];
let auth: AuthService; let perms: PermissionService;
let approverSecret = '';

function makePool(pg: PGlite) {
  let txChain: Promise<void> = Promise.resolve();
  const query = async (sql: string, params?: unknown[]) => {
    const p = (params ?? []).map((v) => (v === undefined ? null : v));
    const r: any = p.length ? await pg.query(sql, p) : ((await pg.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 });
    return { rows: r.rows, rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
  };
  return {
    query,
    // Një lidhje e vetme: transaksionet presin njëri-tjetrin.
    connect: async () => {
      let release!: () => void;
      const prev = txChain;
      txChain = new Promise<void>((res) => { release = res; });
      await prev;
      return { query, release: () => release() };
    },
    end: async () => undefined,
  };
}

function register(ctrl: any): void {
  const prefix: string = ctrl.constructor.__prefix ?? '';
  for (const r of (ctrl.constructor.prototype.__routes ?? []) as RouteDef[]) {
    routes.push({ method: r.method, parts: `${prefix}/${r.path}`.split('/').filter(Boolean), ctrl, handler: r.handler });
  }
}

export async function initBackend(progress: (msg: string) => void): Promise<void> {
  const g = globalThis as any;
  progress('Po niset databaza…');
  const ext: Record<string, Uint8Array> = { 'citext.tar.gz': b64(g.__PGX.citext), 'btree_gist.tar.gz': b64(g.__PGX.btree_gist) };
  // Shtesat e databazës ngarkohen nga të dhënat e vetë faqes, jo nga rrjeti.
  const realFetch = g.fetch?.bind(g);
  g.fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    if (url.startsWith(EXT_HOST)) return new Response(ext[url.slice(EXT_HOST.length)] as BodyInit, { status: 200 });
    return realFetch(input, init);
  };
  const extension = (name: string) => ({ name, setup: async () => ({ bundlePath: new URL(`${EXT_HOST}${name}.tar.gz`) }) });
  const pg = await PGlite.create({
    pgliteWasmModule: await WebAssembly.compile(b64(g.__PGW) as BufferSource),
    initdbWasmModule: await WebAssembly.compile(b64(g.__PGX.initdb) as BufferSource),
    fsBundle: new Blob([b64(g.__PGD) as BlobPart]),
    extensions: { citext: extension('citext'), btree_gist: extension('btree_gist') },
    // Si driver-i i serverit: numrat e mëdhenj dhe dhjetorët vijnë si tekst, kurrë si float.
    parsers: { 20: (v: string) => v, 1700: (v: string) => v },
  } as any);
  g.__PGW = g.__PGD = undefined;
  const db: any = makePool(pg);

  progress('Po krijohen tabelat dhe rregullat…');
  for (const m of MIGRATIONS) await pg.exec(`BEGIN;\n${m.sql}\n;COMMIT;`);

  progress('Po krijohen përdoruesit dhe të dhënat testuese…');
  await seed(db, { adminPassword: ADMIN_PASSWORD, approverPassword: APPROVER.password, demoPassword: DEMO.password });

  const audit = new AuditService(db);
  perms = new PermissionService(db);
  auth = new AuthService(db, audit);
  const approvals = new ApprovalsService(db, perms, audit);
  const access = new AccessService(db, approvals, perms, audit);
  const ledger = new LedgerService(db, perms, audit, approvals);
  const inventory = new InventoryService(db, perms, audit, approvals);
  const sales = new SalesService(db, perms, audit, approvals);
  const cash = new CashService(db, perms, audit, approvals, ledger);
  const billing = new BillingService(db, perms, audit, ledger, cash, approvals);
  const purchasing = new PurchasingService(db, perms, audit, approvals, ledger);
  for (const s of [access, ledger, inventory, sales, cash, billing, purchasing]) s.onModuleInit();

  routes = [];
  [new AuthController(auth, perms), new OrgController(db), new ApprovalsController(approvals), new AccessController(access), new AuditController(audit),
    new LedgerController(ledger), new InventoryController(inventory), new SalesController(sales), new BillingController(billing), new CashController(cash),
    new PurchasingController(purchasing), new ReportsController(db, perms)].forEach(register);

  // Aprovuesi merr 2FA që në fillim, që aprovimet të provohen me një klikim (kodi llogaritet këtu, vetëm në provë).
  progress('Po përgatitet personi i dytë për aprovime…');
  const t = (await auth.login(APPROVER.email, APPROVER.password, undefined, '127.0.0.1')).token;
  const u = (await auth.resolveSession(t)) as AuthUser;
  approverSecret = (await auth.mfaSetup(u)).secret;
  await auth.mfaEnable(u, totpAt(approverSecret, Date.now()));

  // Pak mall fillestar, që ekranet të mos jenë bosh.
  const demo = (await auth.resolveSession(await loginAs('demo'))) as AuthUser;
  const wh = await db.query('SELECT id, code FROM warehouse ORDER BY code');
  for (const w of wh.rows as { id: string; code: string }[]) {
    await inventory.receive(demo, { warehouseId: Number(w.id), sku: 'TEST-PLL-6060', qty: '28.80', lot: { lotCode: 'L-2026-01', shade: 'A12', caliber: '9' }, documentRef: 'HYRJE-FILLESTARE', idempotencyKey: `init-pll-${w.code}` });
    await inventory.receive(demo, { warehouseId: Number(w.id), sku: 'TEST-WC-01', qty: '12', documentRef: 'HYRJE-FILLESTARE', idempotencyKey: `init-wc-${w.code}` });
  }
}

export async function loginAs(who: 'demo' | 'approver'): Promise<string> {
  if (who === 'demo') return (await auth.login(DEMO.email, DEMO.password, undefined, '127.0.0.1')).token;
  return (await auth.login(APPROVER.email, APPROVER.password, totpAt(approverSecret, Date.now()), '127.0.0.1')).token;
}

function match(method: string, parts: string[]): { route: Route; params: Record<string, string> } | null {
  let best: { route: Route; params: Record<string, string>; literals: number } | null = null;
  for (const route of routes) {
    if (route.method !== method || route.parts.length !== parts.length) continue;
    const params: Record<string, string> = {}; let literals = 0; let ok = true;
    route.parts.forEach((seg, i) => {
      if (seg.startsWith(':')) params[seg.slice(1)] = parts[i] as string;
      else if (seg === parts[i]) literals++;
      else ok = false;
    });
    if (ok && (!best || literals > best.literals)) best = { route, params, literals };
  }
  return best;
}

/** E njëjta sjellje si serveri: sesioni, lejet, validimi, kodet e gabimeve. */
export async function handle(method: string, fullPath: string, body: unknown, token: string | null): Promise<{ status: number; body: unknown }> {
  try {
    const [path = '', qs = ''] = fullPath.split('?');
    const m = match(method.toUpperCase(), path.split('/').filter(Boolean));
    if (!m) return { status: 404, body: { code: 'HTTP', message: 'Nuk u gjet' } };
    const fn = m.route.ctrl[m.route.handler];
    const meta = { ...(m.route.ctrl.constructor.__meta ?? {}), ...(fn.__meta ?? {}) };
    const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {}, ip: '127.0.0.1' };
    if (!meta.isPublic) {
      if (!token) throw new DomainError('UNAUTHENTICATED', 'Duhet të hyni në sistem', 401);
      const user = await auth.resolveSession(token);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Sesioni ka skaduar ose është revokuar', 401);
      req.user = user;
      if (meta.requiredPermission && !(await perms.has(user.id, meta.requiredPermission))) throw forbidden();
    }
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
    const defs: ParamDef[] = m.route.ctrl.constructor.prototype.__params?.[m.route.handler] ?? [];
    const args = defs.map((d) => {
      if (d.kind === 'body') return body ?? {};
      if (d.kind === 'query') return Object.fromEntries(new URLSearchParams(qs));
      if (d.kind === 'req') return req;
      if (d.kind === 'custom') return d.fn?.(undefined, ctx);
      const raw = m.params[d.name as string];
      if (d.pipe === ParseIntPipe) {
        if (!/^\d+$/.test(raw ?? '')) throw new DomainError('VALIDATION', 'Identifikues i pavlefshëm');
        return Number(raw);
      }
      return raw;
    });
    const result = await fn.apply(m.route.ctrl, args);
    const status = fn.__status ?? (method.toUpperCase() === 'POST' ? 201 : 200);
    // Kalim nëpër JSON, si në rrjet: datat bëhen tekst, vlerat e papërcaktuara hiqen.
    return { status, body: result === undefined ? undefined : JSON.parse(JSON.stringify(result)) };
  } catch (err) {
    const out = toHttpError(err);
    if (out.unexpected) console.error(err);
    return { status: out.status, body: out.body };
  }
}
