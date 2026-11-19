// Test me Chrome i provës që punon brenda shfletuesit (pa server, pa databazë jashtë faqes).
// Nisja: npm run demo:build && node apps/demo/e2e.mjs
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const server = createServer((req, res) => {
  try {
    const name = (req.url === '/' ? '/index.html' : req.url).split('?')[0].slice(1);
    if (!/^[\w.-]+$/.test(name)) throw new Error('emër i palejuar');
    const data = readFileSync(join(dist, name));
    res.writeHead(200, { 'content-type': TYPES[name.split('.').pop()] ?? 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const step = (m) => console.log(`✓ ${m}`);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.setDefaultTimeout(20000);
await page.setViewport({ width: 1180, height: 820 });
const errors = []; const external = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
const shot = async (name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };
const text = () => page.evaluate(() => document.body.innerText);
const waitText = (t) => page.waitForFunction((x) => document.body.innerText.includes(x), {}, t);
const go = async (hash, marker) => { await page.evaluate((h) => { location.hash = h; }, hash); await waitText(marker); };
const clickButton = async (label) => {
  const ok = await page.evaluate((l) => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === l && !x.disabled); if (b) b.click(); return !!b; }, label);
  if (!ok) throw new Error(`Butoni "${label}" nuk u gjet ose është i çaktivizuar`);
};
const type = async (sel, v) => {
  await page.waitForSelector(sel); await page.click(sel);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); await page.type(sel, v);
};
const approveAll = async (expected) => {
  await clickButton('Aprovuesi (personi i dytë)'); await go('#aprovimet', 'Aprovo');
  for (let i = 0; i < expected; i++) {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Aprovo' && !b.disabled));
    const before = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Aprovo').length);
    await clickButton('Aprovo');
    await page.waitForFunction((n) => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Aprovo').length < n, {}, before);
  }
  await clickButton('Punonjësi (demo)');
};

try {
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 120000 });
  await waitText('Lejet tuaja'); await waitText('Dega Prizren');
  await shot('0-paneli');
  step(`sistemi dhe databaza u nisën brenda faqes për ${((Date.now() - t0) / 1000).toFixed(1)} s; paneli hapet i kyçur si përdoruesi demo`);

  await go('#stoku', 'L-2026-01');
  if (!(await text()).includes('28,8 m²')) throw new Error('Stoku fillestar nuk shfaqet');
  await page.select('#rsku', 'TEST-PLL-6060'); await type('#rqty', '1'); await type('#rdoc', 'FH-PROVE-1'); await type('#rlot', 'L-PROVE'); await type('#rshade', 'B2');
  await clickButton('Regjistro hyrjen'); await waitText('nuk përputhet me paketimin');
  step('rregulli i databazës punon: sasia që nuk është kuti e plotë refuzohet');
  await type('#rqty', '14,40'); await clickButton('Regjistro hyrjen'); await waitText('Hyrja u regjistrua.'); await waitText('L-PROVE');
  step('hyrja e mallit u regjistrua');

  await go('#klientet', 'Shto klientin');
  await type('#code', 'kl-prove'); await type('#name', 'Klient provë'); await clickButton('Shto klientin'); await waitText('Klienti u shtua.'); await waitText('KL-PROVE');
  step('klienti u krijua');

  await go('#arka', 'Arka Prishtinë'); await clickButton('Hap arkën'); await waitText('u hap me 0,00 €');
  step('arka u hap');

  await go('#shitjet', 'Krijo ofertën');
  await type('#q0', '2,88'); await type('#d0', '5');
  await clickButton('Krijo ofertën'); await waitText('u krijua.');
  await clickButton('Konfirmo porosinë'); await waitText('Porosia u konfirmua dhe malli u rezervua.');
  await type('#doc', 'FD-PROVE-1'); await clickButton('Dorëzo mallin e mbetur'); await waitText('Malli u dorëzua');
  await page.waitForSelector('#pm'); await clickButton('Lësho faturën dhe arkëto'); await waitText('Fatura nr. 1 u lëshua: 40,36 €');
  await shot('1-shitjet');
  step('shitja e plotë: ofertë → porosi → dorëzim → faturë 40,36 € me arkëtim');

  await go('#libri', 'Bilanci vërtetues'); await waitText('T-1000');
  const led = await text();
  if (!led.includes('40,36') || !led.includes('34,20') || !led.includes('6,16')) throw new Error('Libri kryesor nuk i tregon shumat e faturës');
  step('libri kryesor u kontabilizua vetë: arka 40,36, të ardhurat 34,20, TVSH 6,16');

  await go('#shitjet', 'Shiko / printo');
  await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.innerText.includes('Shiko / printo')).click());
  await waitText('Faturë nr. 1/'); await waitText('DOKUMENT PROVIZOR');
  await shot('2-fatura');
  await type('#ret1', '1,44'); await type('#retreason', 'Klienti ktheu një kuti të pahapur'); await clickButton('Kërko notë krediti');
  await waitText('Kërkesa për notë krediti u dërgua për aprovim');
  step('fatura hapet; kthimi i mallit u kërkua dhe pret aprovimin');

  await go('#aprovimet', 'Aprovimet');
  if (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Aprovo' && !b.disabled))) throw new Error('Kërkuesi nuk duhet të mund ta aprovojë vetë');
  step('kërkuesi nuk e aprovon dot kërkesën e vet');
  await approveAll(1);
  step('personi i dytë (me 2FA) e aprovoi notën e kreditit');

  await go('#arka', 'Duhet të jenë në arkë');
  await shot('3-arka');
  const expected = /Duhet të jenë në arkë: ([\d.,]+) €/.exec(await text())[1];
  await type('input[inputmode="decimal"]', expected); await clickButton('Mbyll arkën'); await waitText('Arka u mbyll pa diferencë');
  step(`arka u mbyll pa diferencë (sistemi priste ${expected} €)`);

  await go('#blerjet', 'Shto furnitorin');
  await type('#scode', 'fur-prove'); await type('#sname', 'Furnitor provë'); await clickButton('Shto furnitorin'); await waitText('Furnitori u shtua.');
  await page.waitForSelector('#pp0'); await page.select('#pp0', 'TEST-WC-01'); await type('#pq0', '5'); await type('#pc0', '45');
  await clickButton('Krijo porosinë'); await waitText('u krijua.');
  await clickButton('Dërgo porosinë'); await waitText('Porosia u aprovua');
  await type('#grdoc', 'CMR-PROVE-1'); await clickButton('Prano mallin e mbetur'); await waitText('Malli u pranua dhe hyri në stok');
  await type('#sinv', 'INV-PROVE-1'); await clickButton('Regjistro faturën'); await waitText('Fatura përputhet me porosinë dhe pranimin.');
  await shot('4-blerjet');
  step('blerja: furnitor → porosi 225 € → pranim malli → faturë që përputhet');

  await go('#produktet', 'Shto produktin');
  await type('#psku', 'prove-lavaman'); await type('#pname', 'Lavaman provë'); await page.select('#puom', 'PIECE');
  await clickButton('Shto produktin'); await waitText('Produkti u shtua.'); await waitText('PROVE-LAVAMAN');
  step('produkt i ri u shtua');

  await go('#raportet', 'Shitjet sipas degës');
  if (!(await text()).includes('Furnitor provë')) throw new Error('Raportet nuk e tregojnë detyrimin ndaj furnitorit');
  await shot('5-raportet');
  step('raportet tregojnë shitjet dhe detyrimin ndaj furnitorit');

  for (const [hash, marker] of [['#perdoruesit', 'Krijo përdoruesin'], ['#siguria', 'Siguria'], ['#paneli', 'Lejet tuaja']]) await go(hash, marker);
  step('ekranet e tjera hapen');

  await clickButton('Dil'); await page.waitForSelector('#email');
  await type('#email', 'demo@temaj.test'); await type('#pw', 'fjalekalim-i-gabuar'); await clickButton('Hyr'); await waitText('Email-i ose fjalëkalimi është i pasaktë');
  await type('#pw', 'Demo-Prove-Temaj-2026'); await clickButton('Hyr'); await waitText('Lejet tuaja');
  step('dalja dhe hyrja me dorë funksionojnë (fjalëkalimi i gabuar refuzohet)');

  if (external.length) throw new Error(`Faqja kërkoi adresa jashtë vetes: ${external.join(', ')}`);
  step('faqja nuk kërkoi asgjë nga rrjeti jashtë skedarëve të vet');
  if (errors.length) throw new Error(`Gabime JavaScript në faqe: ${errors.join(' | ')}`);
  console.log('\nTë gjitha hapat e provës në shfletues kaluan.');
} catch (e) {
  await page.screenshot({ path: '/tmp/demo-failure.png', fullPage: true }).catch(() => undefined);
  console.error(`✗ ${e.message}\n(pamja u ruajt te /tmp/demo-failure.png)`);
  if (errors.length) console.error('Gabime në faqe:', errors.join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined); server.close();
  process.exit(process.exitCode ?? 0);
}
