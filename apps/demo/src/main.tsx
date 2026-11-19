import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ApprovalsPage from '../../web/app/aprovimet/page';
import CashPage from '../../web/app/arka/page';
import PurchasingPage from '../../web/app/blerjet/page';
import InvoicePage from '../../web/app/fatura/[id]/page';
import LoginPage from '../../web/app/hyrja/page';
import CustomersPage from '../../web/app/klientet/page';
import LedgerPage from '../../web/app/libri/page';
import Dashboard from '../../web/app/page';
import UsersPage from '../../web/app/perdoruesit/page';
import ProductsPage from '../../web/app/produktet/page';
import ReportsPage from '../../web/app/raportet/page';
import SalesPage from '../../web/app/shitjet/page';
import SecurityPage from '../../web/app/siguria/page';
import StockPage from '../../web/app/stoku/page';
import { tokenStore } from '../../web/lib/api';
import { hashToPath, usePath } from '../shims/next-navigation';
import { DEMO, handle, initBackend, loginAs } from './backend';

const PAGES: Record<string, () => JSX.Element> = {
  '/': Dashboard, '/hyrja': LoginPage, '/shitjet': SalesPage, '/klientet': CustomersPage, '/arka': CashPage, '/blerjet': PurchasingPage, '/stoku': StockPage,
  '/produktet': ProductsPage, '/libri': LedgerPage, '/raportet': ReportsPage, '/aprovimet': ApprovalsPage, '/perdoruesit': UsersPage, '/siguria': SecurityPage,
};

function App() {
  const path = usePath();
  const [who, setWho] = useState<'demo' | 'approver' | null>('demo');
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const Page = path.startsWith('/fatura/') ? InvoicePage : (PAGES[path] ?? Dashboard);

  async function switchTo(w: 'demo' | 'approver') {
    setBusy(true);
    try {
      tokenStore.set(await loginAs(w));
      setWho(w);
      if (hashToPath(location.hash) === '/hyrja') location.hash = '#paneli';
      setEpoch((e) => e + 1);   // rindërton ekranin me përdoruesin e ri
    } finally { setBusy(false); }
  }

  return (<>
    <div className="prove-bar">
      <strong>Provë brenda shfletuesit</strong>
      <span>Sistemi dhe databaza punojnë në këtë skedë. Të dhënat janë testuese dhe fshihen kur mbyllet ose rifreskohet faqja.</span>
      <span className="grow" />
      <button className={who === 'demo' ? 'on' : ''} disabled={busy} onClick={() => { void switchTo('demo'); }}>Punonjësi (demo)</button>
      <button className={who === 'approver' ? 'on' : ''} disabled={busy} onClick={() => { void switchTo('approver'); }}>Aprovuesi (personi i dytë)</button>
    </div>
    {path === '/hyrja' && <p className="prove-hint">Për të hyrë me dorë: <code>{DEMO.email}</code> / <code>{DEMO.password}</code></p>}
    <div key={`${epoch}`}><Page /></div>
  </>);
}

// Brenda Claude printimi mund të mos lejohet: butoni nuk duhet ta prishë faqen.
const realPrint = window.print?.bind(window);
try { window.print = () => { try { realPrint?.(); } catch { /* i palejuar në këtë mjedis */ } }; } catch { /* vetëm-lexim */ }

const status = document.getElementById('boot-status') as HTMLElement;
initBackend((msg) => { status.textContent = msg; })
  .then(async () => {
    (globalThis as { __temajLocalApi?: unknown }).__temajLocalApi = handle;
    tokenStore.set(await loginAs('demo'));   // prova hapet e kyçur si përdoruesi demo
    if (hashToPath(location.hash) === '/hyrja') location.hash = '#paneli';
    createRoot(document.getElementById('root') as HTMLElement).render(<App />);
    (document.getElementById('boot') as HTMLElement).remove();
  })
  .catch((e: unknown) => {
    console.error(e);
    status.innerHTML = '';
    status.append('Sistemi nuk u nis në këtë shfletues. ', Object.assign(document.createElement('code'), { textContent: e instanceof Error ? e.message : String(e) }));
  });
