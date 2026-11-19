// Test i ndërfaqes me shfletues të vërtetë (Chrome): rrjedha e plotë e shitjes nga ekrani.
// Kërkon: API në :4000 dhe web në :3000 me databazë të sapombushur (db:seed me SEED_DEMO_PASSWORD).
// Nisja: CHROME_PATH=/usr/bin/google-chrome DEMO_PASSWORD=... node apps/web/e2e/smoke.mjs
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const step = (m) => console.log(`✓ ${m}`);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const text = () => page.evaluate(() => document.body.innerText);
const waitText = (t) => page.waitForFunction((x) => document.body.innerText.includes(x), {}, t);
const clickButton = async (label) => {
  const ok = await page.evaluate((l) => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === l && !x.disabled); if (b) b.click(); return !!b; }, label);
  if (!ok) throw new Error(`Butoni "${label}" nuk u gjet ose është i çaktivizuar`);
};
const type = async (sel, v) => {
  await page.click(sel);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(sel, v);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email');                         // pa sesion → ridrejtim te hyrja
  step('pa hyrje, paneli ridrejton te faqja e hyrjes');

  await type('#email', 'demo@temaj.test'); await type('#pw', 'fjalekalim-i-gabuar');
  await clickButton('Hyr'); await waitText('Email-i ose fjalëkalimi është i pasaktë');
  step('fjalëkalimi i gabuar jep mesazh gabimi në shqip');

  await type('#pw', process.env.DEMO_PASSWORD); await clickButton('Hyr');
  await waitText('Lejet tuaja'); await waitText('Dega Prizren');
  step('hyrja funksionon; paneli shfaq degët');

  await page.goto(`${BASE}/klientet`, { waitUntil: 'networkidle0' });
  await type('#code', 'kl-e2e'); await type('#name', 'Klient nga shfletuesi');
  await clickButton('Shto klientin'); await waitText('Klienti u shtua.'); await waitText('KL-E2E');
  step('klienti u krijua nga formulari');

  await page.goto(`${BASE}/stoku`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#rsku'); await page.select('#rsku', 'TEST-PLL-6060');
  await page.waitForSelector('#rlot');
  await type('#rqty', '1'); await type('#rdoc', 'FH-E2E-1'); await type('#rlot', 'L-E2E'); await type('#rshade', 'A1');
  await clickButton('Regjistro hyrjen'); await waitText('nuk përputhet me paketimin');
  step('sasia që nuk është kuti e plotë refuzohet me mesazh të qartë');
  await type('#rqty', '14,40'); await clickButton('Regjistro hyrjen'); await waitText('Hyrja u regjistrua.'); await waitText('L-E2E');
  if (!(await text()).includes('14,4 m²')) throw new Error('Stoku nuk tregon 14,4 m²');
  step('hyrja e mallit (14,40 m² = 10 kuti) u regjistrua dhe shfaqet në stok');

  await page.goto(`${BASE}/shitjet`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#q0'); await type('#q0', '2,88'); await type('#d0', '5');
  await clickButton('Krijo ofertën'); await waitText('u krijua.'); await waitText('Ofertë');
  step('oferta u krijua nga formulari');
  await clickButton('Konfirmo porosinë'); await waitText('Porosia u konfirmua dhe malli u rezervua.');
  step('porosia u konfirmua dhe malli u rezervua');
  await page.waitForSelector('#doc'); await type('#doc', 'FD-E2E-1');
  await clickButton('Dorëzo mallin e mbetur'); await waitText('Malli u dorëzua');
  step('malli u dorëzua');
  await page.waitForSelector('#pm'); await clickButton('Lësho faturën dhe arkëto'); await waitText('Fatura nr. 1 u lëshua: 40,36 €');
  step('fatura u lëshua me arkëtim: 2,88 × 12,50 − 5 % = 34,20 + TVSH 18 % = 40,36 €');
  if (process.env.SCREENSHOT_DIR) { await page.setViewport({ width: 1100, height: 900 }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/shitjet.png`, fullPage: true }); }

  await page.waitForFunction(() => [...document.querySelectorAll('#p0 option')].some((o) => o.textContent.includes('11,52')));
  step('lista e stokut në formularin e ofertës u përditësua pas shitjes');
  await page.goto(`${BASE}/stoku`, { waitUntil: 'networkidle0' }); await waitText('L-E2E');
  if (!(await text()).includes('11,52 m²')) throw new Error('Stoku pas shitjes duhet të jetë 11,52 m²');
  step('stoku ra në 11,52 m² pas dorëzimit');

  await page.goto(`${BASE}/libri`, { waitUntil: 'networkidle0' }); await waitText('Bilanci vërtetues'); await waitText('T-1000');
  const t = await text();
  if (!t.includes('40,36') || !t.includes('34,20') || !t.includes('6,16')) throw new Error('Libri kryesor nuk i tregon shumat e faturës');
  step('libri kryesor tregon arkën 40,36, të ardhurat 34,20 dhe TVSH-në 6,16');

  for (const path of ['/blerjet', '/aprovimet', '/siguria', '/klientet']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    if ((await text()).includes('Application error')) throw new Error(`Faqja ${path} ka gabim`);
  }
  step('faqet e tjera hapen pa gabime');

  await clickButton('Dil'); await page.waitForSelector('#email');
  step('dalja nga sistemi funksionon');
  if (errors.length) throw new Error(`Gabime JavaScript në faqe: ${errors.join(' | ')}`);
  console.log('\nTë gjitha hapat e ndërfaqes kaluan.');
} catch (e) {
  await page.screenshot({ path: '/tmp/e2e-failure.png', fullPage: true });
  console.error(`✗ ${e.message}\n(pamja u ruajt te /tmp/e2e-failure.png)`);
  if (errors.length) console.error('Gabime në faqe:', errors.join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close();
}
