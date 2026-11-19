import { Pool } from 'pg';
import { hashPassword } from '../auth/crypto';

/**
 * Të dhëna SINTETIKE për Development/Staging. Asnjë e dhënë reale e Temaj-it.
 * Emrat ligjorë, NUI dhe NRB mbeten bosh deri në OPEN-11.
 */
export const PERMISSIONS: [string, string][] = [
  ['org.read', 'Shiko degët, magazinat dhe rolet'],
  ['admin.users.manage', 'Krijo dhe çaktivizo përdorues'],
  ['admin.roles.request', 'Kërko dhënien e një roli (kalon në aprovim)'],
  ['admin.roles.revoke', 'Hiq një rol menjëherë'],
  ['approvals.access.decide', 'Aprovo ose refuzo kërkesat për qasje'],
  ['audit.read', 'Lexo audit trail-in'],
  ['ledger.read', 'Shiko librin kryesor'],
  ['ledger.entry.create', 'Krijo regjistrime kontabël (draft)'],
  ['ledger.entry.post', 'Posto regjistrime kontabël'],
  ['ledger.entry.reverse', 'Kthe (storno) regjistrime të postuara'],
  ['ledger.period.request_close', 'Kërko mbylljen e periudhës (kalon në aprovim)'],
  ['approvals.ledger.decide', 'Aprovo ose refuzo mbylljen e periudhave'],
  ['catalog.manage', 'Krijo dhe ndrysho produkte'],
  ['stock.read', 'Shiko gjendjen e stokut'],
  ['stock.receive', 'Regjistro hyrje malli'],
  ['stock.dispatch', 'Regjistro dalje malli'],
  ['stock.transfer.dispatch', 'Dërgo transfer te një magazinë tjetër'],
  ['stock.transfer.receive', 'Konfirmo pranimin e një transferi'],
  ['stock.adjust.request', 'Kërko korrigjim stoku (kalon në aprovim)'],
  ['approvals.stock.decide', 'Aprovo ose refuzo korrigjimet e stokut'],
  ['customers.read', 'Shiko klientët'],
  ['customers.manage', 'Krijo dhe ndrysho klientë'],
  ['customers.credit.manage', 'Vendos limitin e kreditit të klientit'],
  ['pricing.manage', 'Vendos çmimet e listës'],
  ['sales.read', 'Shiko ofertat dhe porositë'],
  ['sales.order.create', 'Krijo oferta'],
  ['sales.order.confirm', 'Konfirmo ose anulo porosi'],
  ['sales.deliver', 'Dorëzo mallin e porosive'],
  ['approvals.sales.decide', 'Aprovo përjashtimet e shitjes (zbritje, çmim, nuanca)'],
  ['sales.invoice.create', 'Lësho fatura shitjeje'],
  ['payments.receive', 'Regjistro arkëtime nga klientët'],
  ['suppliers.manage', 'Krijo dhe ndrysho furnitorë'],
  ['purchase.read', 'Shiko porositë e blerjes'],
  ['purchase.order.create', 'Krijo dhe dërgo porosi blerjeje'],
  ['purchase.invoice.enter', 'Regjistro faturat e furnitorëve'],
  ['approvals.purchase.decide', 'Aprovo porositë e blerjes mbi prag'],
];

export const ROLES: { code: string; name: string; permissions: string[] }[] = [
  { code: 'SYSTEM_ADMIN', name: 'Administrator i sistemit', permissions: ['org.read', 'admin.users.manage', 'admin.roles.request', 'admin.roles.revoke', 'audit.read'] },
  { code: 'SECURITY_APPROVER', name: 'Aprovues i qasjes', permissions: ['org.read', 'approvals.access.decide', 'audit.read', 'admin.roles.revoke'] },
  { code: 'BRANCH_MANAGER', name: 'Menaxher dege', permissions: ['org.read', 'admin.roles.request'] },
  { code: 'ACCOUNTANT', name: 'Kontabilist', permissions: ['org.read', 'ledger.read', 'ledger.entry.create', 'ledger.entry.post', 'ledger.entry.reverse', 'ledger.period.request_close'] },
  { code: 'FINANCE_APPROVER', name: 'Aprovues financiar', permissions: ['org.read', 'ledger.read', 'approvals.ledger.decide'] },
  { code: 'PURCHASER', name: 'Blerës', permissions: ['org.read', 'stock.read', 'purchase.read', 'suppliers.manage', 'purchase.order.create'] },
  { code: 'PURCHASE_APPROVER', name: 'Aprovues blerjesh', permissions: ['org.read', 'purchase.read', 'approvals.purchase.decide'] },
  { code: 'AP_CLERK', name: 'Financë — faturat e furnitorëve', permissions: ['org.read', 'purchase.read', 'purchase.invoice.enter'] },
  { code: 'CASHIER', name: 'Arkëtar', permissions: ['org.read', 'customers.read', 'sales.read', 'sales.invoice.create', 'payments.receive'] },
  { code: 'SALESPERSON', name: 'Shitës', permissions: ['org.read', 'stock.read', 'customers.read', 'customers.manage', 'sales.read', 'sales.order.create', 'sales.order.confirm'] },
  { code: 'SALES_MANAGER', name: 'Menaxher shitjesh', permissions: ['org.read', 'stock.read', 'customers.read', 'customers.manage', 'customers.credit.manage', 'pricing.manage', 'sales.read', 'approvals.sales.decide'] },
  { code: 'WAREHOUSE_KEEPER', name: 'Magazinier', permissions: ['org.read', 'stock.read', 'sales.read', 'sales.deliver', 'purchase.read', 'stock.receive', 'stock.dispatch', 'stock.transfer.dispatch', 'stock.transfer.receive', 'stock.adjust.request'] },
  { code: 'WAREHOUSE_MANAGER', name: 'Menaxher magazine', permissions: ['org.read', 'stock.read', 'approvals.stock.decide'] },
  { code: 'CATALOG_MANAGER', name: 'Menaxher katalogu', permissions: ['org.read', 'stock.read', 'catalog.manage'] },
  { code: 'EMPLOYEE', name: 'Punonjës', permissions: ['org.read'] },
];

export const TEST_ACCOUNTS: [string, string, string][] = [
  ['T-1000', 'Arka (test)', 'ASSET'],
  ['T-1100', 'Banka (test)', 'ASSET'],
  ['T-1200', 'Klientë — të arkëtueshme (test)', 'ASSET'],
  ['T-1300', 'Avanse ndaj punonjësve (test)', 'ASSET'],
  ['T-2000', 'Detyrime ndaj furnitorëve (test)', 'LIABILITY'],
  ['T-2300', 'Avanse nga klientët (test)', 'LIABILITY'],
  ['T-2400', 'TVSH e llogaritur (test)', 'LIABILITY'],
  ['T-3000', 'Kapitali (test)', 'EQUITY'],
  ['T-4000', 'Të ardhura (test)', 'REVENUE'],
  ['T-6000', 'Shpenzime bonusesh (test)', 'EXPENSE'],
];

export async function seed(pool: Pool, opts: { adminPassword: string; approverPassword: string; demoPassword?: string }): Promise<void> {
  if (process.env.APP_ENV === 'production') throw new Error('Seed-i sintetik është i ndaluar në Production');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [code, desc] of PERMISSIONS) {
      await c.query('INSERT INTO permission(code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING', [code, desc]);
    }
    for (const r of ROLES) {
      const role = await c.query<{ id: string }>(
        `INSERT INTO role(code, name, is_system) VALUES ($1, $2, TRUE)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [r.code, r.name]);
      for (const p of r.permissions) {
        await c.query('INSERT INTO role_permission(role_id, permission_code) VALUES ($1, $2) ON CONFLICT DO NOTHING', [role.rows[0]?.id, p]);
      }
    }
    // Struktura juridike pret OPEN-01: modelohet si një subjekt i paverifikuar, i ndryshueshëm.
    const le = await c.query<{ id: string }>(
      `INSERT INTO legal_entity(code, name, verified) VALUES ('TEMAJ', 'Temaj Qeramike (pa verifikuar)', FALSE)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const leId = le.rows[0]?.id;
    for (const [code, name, city] of [['PZ', 'Dega Prizren', 'Prizren'], ['PR', 'Dega Prishtinë', 'Prishtinë']] as const) {
      const b = await c.query<{ id: string }>(
        `INSERT INTO branch(legal_entity_id, code, name, city) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [leId, code, name, city]);
      await c.query(
        `INSERT INTO warehouse(branch_id, code, name) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [b.rows[0]?.id, `${code}-MAIN`, `Magazina kryesore ${city}`]);
    }
    await c.query(
      `INSERT INTO approval_policy(action_code, branch_id, min_amount, required_approvals, approver_permission, escalate_after_hours)
       SELECT 'access.grant_role', NULL, 0, 1, 'approvals.access.decide', 24
        WHERE NOT EXISTS (SELECT 1 FROM approval_policy WHERE action_code = 'access.grant_role' AND branch_id IS NULL)`);

    await c.query(
      `INSERT INTO approval_policy(action_code, branch_id, min_amount, required_approvals, approver_permission, escalate_after_hours)
       SELECT 'ledger.close_period', NULL, 0, 1, 'approvals.ledger.decide', 48
        WHERE NOT EXISTS (SELECT 1 FROM approval_policy WHERE action_code = 'ledger.close_period' AND branch_id IS NULL)`);

    await c.query(
      `INSERT INTO approval_policy(action_code, branch_id, min_amount, required_approvals, approver_permission, escalate_after_hours)
       SELECT 'stock.adjust', NULL, 0, 1, 'approvals.stock.decide', 24
        WHERE NOT EXISTS (SELECT 1 FROM approval_policy WHERE action_code = 'stock.adjust' AND branch_id IS NULL)`);
    await c.query(
      `INSERT INTO approval_policy(action_code, branch_id, min_amount, required_approvals, approver_permission, escalate_after_hours)
       SELECT 'sales.order_exception', NULL, 0, 1, 'approvals.sales.decide', 8
        WHERE NOT EXISTS (SELECT 1 FROM approval_policy WHERE action_code = 'sales.order_exception' AND branch_id IS NULL)`);
    // PRAG TESTUES: porositë e blerjes nga 1000 € e lart kërkojnë aprovim. Vlerën reale e vendos drejtoria (DEC-G50-01).
    await c.query(
      `INSERT INTO approval_policy(action_code, branch_id, min_amount, required_approvals, approver_permission, escalate_after_hours)
       SELECT 'purchase.approve_po', NULL, 1000, 1, 'approvals.purchase.decide', 24
        WHERE NOT EXISTS (SELECT 1 FROM approval_policy WHERE action_code = 'purchase.approve_po' AND branch_id IS NULL)`);
    // LIMITE TESTUESE zbritjeje — vlerat reale i vendos drejtoria (DEC-G48-01).
    await c.query(
      `INSERT INTO discount_limit(role_id, max_pct) SELECT id, 5 FROM role WHERE code = 'SALESPERSON' ON CONFLICT DO NOTHING`);
    // PRODUKTE TESTUESE — jo katalogu i Temaj-it (OPEN-21).
    await c.query(
      `INSERT INTO product(sku, name, base_uom, pieces_per_box, m2_per_piece, allow_partial_box, tracks_lot) VALUES
         ('TEST-PLL-6060', 'Pllakë 60x60 (test)', 'M2', 4, 0.36, FALSE, TRUE),
         ('TEST-PLL-3060', 'Pllakë 30x60, kuti të hapura (test)', 'M2', 8, 0.18, TRUE, TRUE),
         ('TEST-WC-01', 'WC shkollë (test)', 'PIECE', NULL, NULL, FALSE, FALSE)
       ON CONFLICT (sku) DO NOTHING`);

    // LLOGARI TESTUESE — jo plani kontabël i Temaj-it. Plani real pret kontabilistin (OPEN-05).
    for (const [code, name, type] of TEST_ACCOUNTS) {
      await c.query(
        `INSERT INTO ledger_account(legal_entity_id, code, name, type, is_provisional) VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (legal_entity_id, code) DO NOTHING`, [leId, code, name, type]);
    }
    await c.query(
      `INSERT INTO fiscal_period(legal_entity_id, name, start_date, end_date)
       SELECT $1, 'Muaji aktual (test)', date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
        WHERE NOT EXISTS (SELECT 1 FROM fiscal_period WHERE legal_entity_id = $1 AND CURRENT_DATE BETWEEN start_date AND end_date)`, [leId]);
    // VLERA PROVIZORE, të vendosura me kërkesë të pronarit për t'u korrigjuar më vonë nga kontabilisti (OPEN-05, OPEN-06).
    await c.query(
      `INSERT INTO policy_setting(key, value, description) VALUES
         ('vat.standard_rate', '{"pct": "18"}', 'Norma standarde e TVSH-së — PROVIZORE, pa verifikim nga kontabilisti'),
         ('money.rounding', '{"decimals": 2, "mode": "half_away_from_zero", "level": "line"}', 'Rrumbullakimi i vlerave në fatura — PROVIZOR')
       ON CONFLICT (key) DO NOTHING`);
    await c.query(
      `INSERT INTO account_role(legal_entity_id, role, account_id)
       SELECT $1, m.role, a.id FROM (VALUES ('RECEIVABLE', 'T-1200'), ('SALES_REVENUE', 'T-4000'), ('VAT_OUTPUT', 'T-2400'),
                                            ('CASH', 'T-1000'), ('BANK', 'T-1100'), ('CUSTOMER_ADVANCES', 'T-2300')) AS m(role, code)
         JOIN ledger_account a ON a.legal_entity_id = $1 AND a.code = m.code
       ON CONFLICT DO NOTHING`, [leId]);

    const users: [string, string, string, string][] = [
      ['admin@temaj.test', 'Administrator (test)', opts.adminPassword, 'SYSTEM_ADMIN'],
      ['aprovues@temaj.test', 'Aprovues (test)', opts.approverPassword, 'SECURITY_APPROVER'],
    ];
    for (const [email, name, pw, roleCode] of users) {
      const u = await c.query<{ id: string }>(
        `INSERT INTO app_user(email, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`, [email, name, await hashPassword(pw)]);
      await c.query(
        `INSERT INTO user_role(user_id, role_id, branch_id)
         SELECT $1, id, NULL FROM role WHERE code = $2
         ON CONFLICT DO NOTHING`, [u.rows[0]?.id, roleCode]);
    }
    // VETËM PËR DEMONSTRIM NË DEVELOPMENT: një përdorues me të gjitha rolet operative, që rrjedha të provohet nga një ekran.
    // Në punë reale këto role i mbajnë persona të ndryshëm (ndarja e detyrave).
    if (opts.demoPassword) {
      const d = await c.query<{ id: string }>(
        `INSERT INTO app_user(email, display_name, password_hash) VALUES ('demo@temaj.test', 'Demo (të gjitha rolet)', $1)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`, [await hashPassword(opts.demoPassword)]);
      await c.query(
        `INSERT INTO user_role(user_id, role_id, branch_id)
         SELECT $1, id, NULL FROM role WHERE code IN ('SALESPERSON', 'WAREHOUSE_KEEPER', 'CASHIER', 'CATALOG_MANAGER', 'PURCHASER', 'ACCOUNTANT', 'AP_CLERK')
         ON CONFLICT DO NOTHING`, [d.rows[0]?.id]);
      await c.query(
        `INSERT INTO product_price(product_id, valid_from, unit_price, set_by)
         SELECT p.id, DATE '2026-01-01', v.price, $1 FROM (VALUES ('TEST-PLL-6060', 12.50), ('TEST-PLL-3060', 11.00), ('TEST-WC-01', 80.00)) AS v(sku, price)
           JOIN product p ON p.sku = v.sku ON CONFLICT DO NOTHING`, [d.rows[0]?.id]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
