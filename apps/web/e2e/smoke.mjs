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

  await page.goto(`${BASE}/arka`, { waitUntil: 'networkidle0' });
  await waitText('Arka Prishtinë'); await clickButton('Hap arkën'); await waitText('u hap me 0,00 €');
  step('arka e Prishtinës u hap');

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

  await page.goto(`${BASE}/shitjet`, { waitUntil: 'networkidle0' }); await waitText('Shiko / printo');
  await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.innerText.includes('Shiko / printo')).click());
  await waitText('Faturë nr. 1/'); await waitText('DOKUMENT PROVIZOR'); await waitText('Për pagesë');
  if (!(await text()).includes('40,36 €')) throw new Error('Fatura e printueshme nuk tregon 40,36 €');
  step('fatura e printueshme hapet, me vulën "dokument provizor"');

  await page.goto(`${BASE}/arka`, { waitUntil: 'networkidle0' }); await waitText('Duhet të jenë në arkë: 40,36 €');
  await type('input[inputmode="decimal"]', '40,36'); await clickButton('Mbyll arkën'); await waitText('Arka u mbyll pa diferencë');
  step('arka u mbyll pa diferencë: sistemi priste 40,36 € dhe aq u numëruan');

  await page.goto(`${BASE}/blerjet`, { waitUntil: 'networkidle0' });
  await type('#scode', 'fur-e2e'); await type('#sname', 'Furnitor nga shfletuesi'); await clickButton('Shto furnitorin'); await waitText('Furnitori u shtua.');
  await page.waitForSelector('#pp0'); await page.select('#pp0', 'TEST-WC-01'); await type('#pq0', '5'); await type('#pc0', '45');
  await clickButton('Krijo porosinë'); await waitText('u krijua.');
  await clickButton('Dërgo porosinë'); await waitText('Porosia u aprovua');
  await page.waitForSelector('#grdoc'); await type('#grdoc', 'CMR-E2E-1'); await clickButton('Prano mallin e mbetur'); await waitText('Malli u pranua dhe hyri në stok');
  await type('#sinv', 'INV-E2E-1'); await clickButton('Regjistro faturën'); await waitText('Fatura përputhet me porosinë dhe pranimin.');
  step('blerja nga ekrani: furnitor → porosi 225 € → pranim malli → faturë që përputhet');

  await page.goto(`${BASE}/produktet`, { waitUntil: 'networkidle0' });
  await type('#psku', 'e2e-lavaman'); await type('#pname', 'Lavaman nga shfletuesi'); await page.select('#puom', 'PIECE');
  await clickButton('Shto produktin'); await waitText('Produkti u shtua.'); await waitText('E2E-LAVAMAN'); await waitText('pa çmim');
  await page.select('#prsku', 'E2E-LAVAMAN'); await type('#prval', '55'); await clickButton('Vendos çmimin'); await waitText('Çmimi u vendos.'); await waitText('55,00 €');
  step('produkt i ri dhe çmimi i tij u vendosën nga ekrani');

  await page.goto(`${BASE}/stoku`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#trqty'); await type('#trqty', '1,44'); await type('#trdoc', 'TR-E2E-1');
  await clickButton('Nis transferin'); await waitText('Malli është në rrugë'); await waitText('Në rrugë');
  await clickButton('Prano të plotë'); await waitText('Pranimin duhet ta konfirmojë një person tjetër nga dërguesi');
  step('transferi u nis; dërguesi nuk e pranon dot vetë (duhet personi i degës tjetër)');
  await type('#adqty', '1,44'); await type('#adreason', 'Kuti e thyer gjatë zhvendosjes');
  await clickButton('Kërko korrigjimin'); await waitText('Korrigjimi u dërgua për aprovim');
  step('korrigjimi i stokut u dërgua për aprovim, pa e ndryshuar stokun');

  await page.goto(`${BASE}/perdoruesit`, { waitUntil: 'networkidle0' });
  await type('#uemail', 'punonjes.e2e@temaj.test'); await type('#uname', 'Punonjës nga shfletuesi'); await type('#upw', 'Fjalekalim-E2E-12345');
  await clickButton('Krijo përdoruesin'); await waitText('Përdoruesi u krijua.'); await waitText('punonjes.e2e@temaj.test');
  await type('#greason', 'Rol për provë nga ekrani'); await clickButton('Kërko rolin'); await waitText('u dërgua për aprovim te një person tjetër');
  step('përdorues i ri u krijua; roli u kërkua dhe pret aprovimin e një personi tjetër');

  for (const path of ['/aprovimet', '/siguria', '/klientet']) {
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
