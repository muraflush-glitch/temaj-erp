'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { decSub, money, newKey, parseNum, qty } from '@/lib/util';
import { Nav } from '../../Nav';

interface Invoice {
  id: string; fiscal_year: number; invoice_no: string; invoice_date: string; due_date: string; vat_rate: string; net: string; vat: string; gross: string;
  is_provisional_tax: boolean; is_fiscalized: boolean; order_id: string; open_amount: string;
  customer_code: string; customer_name: string; customer_phone: string | null;
  branch_name: string; branch_city: string; seller_name: string; seller_tax_number: string | null; seller_verified: boolean;
  lines: { line_no: number; sku: string; name: string; base_uom: string; qty: string; qty_credited: string; unit_price: string; discount_pct: string; net: string; vat: string }[];
  creditNotes: { id: string; credit_no: string; fiscal_year: number; credit_date: string; reason: string; restocked: boolean; gross: string }[];
}
const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };

export default function InvoicePage() {
  const { me } = useMe();
  const params = useParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ret, setRet] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => { api<Invoice>(`/sales/invoices/${params.id}`).then(setInv).catch((e: Error) => setError(e.message)); }, [params.id]);
  useEffect(() => { if (me) load(); }, [me, load]);

  async function requestCredit() {
    setMsg(null);
    try {
      const lines = Object.entries(ret).filter(([, v]) => v.trim() && parseNum(v) !== '0').map(([k, v]) => ({ lineNo: Number(k), qty: parseNum(v) }));
      await api(`/sales/invoices/${params.id}/credit-note-requests`, { method: 'POST', body: { idempotencyKey: newKey(), restock, reason: reason.trim(), lines } });
      setRet({}); setReason(''); setMsg({ ok: true, text: 'Kërkesa për notë krediti u dërgua për aprovim. Fatura dhe stoku ndryshojnë vetëm pas aprovimit.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gabim' }); }
  }

  return (<>
    <Nav me={me} />
    {error && <main><p className="error" role="alert">{error}</p></main>}
    {inv && (
      <div className="invoice">
        <div className="no-print" style={{ marginBottom: 16 }}><button onClick={() => window.print()}>Printo</button></div>
        {(!inv.is_fiscalized || inv.is_provisional_tax) && <div className="stamp">DOKUMENT PROVIZOR — JO FATURË FISKALE</div>}
        <h1>Faturë nr. {inv.invoice_no}/{inv.fiscal_year}</h1>
        <div className="cols">
          <div><strong>Shitësi</strong><br />{inv.seller_name}<br />{inv.branch_name}, {inv.branch_city}<br />
            <span className="muted">Nr. fiskal: {inv.seller_tax_number ?? 'ende i paregjistruar në sistem'}</span></div>
          <div><strong>Blerësi</strong><br />{inv.customer_name}<br /><span className="muted">Kodi: {inv.customer_code}{inv.customer_phone ? ` · ${inv.customer_phone}` : ''}</span></div>
          <div><strong>Data:</strong> {inv.invoice_date}<br /><strong>Afati i pagesës:</strong> {inv.due_date}<br /><strong>Porosia:</strong> #{inv.order_id}</div>
        </div>
        <table><thead><tr><th>#</th><th>Produkti</th><th style={{ textAlign: 'right' }}>Sasia</th><th style={{ textAlign: 'right' }}>Çmimi</th><th style={{ textAlign: 'right' }}>Zbritja</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'right' }}>TVSH</th></tr></thead><tbody>
          {inv.lines.map((l) => (
            <tr key={l.line_no}><td>{l.line_no}</td><td>{l.sku} — {l.name}</td><td style={{ textAlign: 'right' }}>{qty(l.qty)} {UOM[l.base_uom]}</td>
              <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td><td style={{ textAlign: 'right' }}>{qty(l.discount_pct)}%</td>
              <td style={{ textAlign: 'right' }}>{money(l.net)}</td><td style={{ textAlign: 'right' }}>{money(l.vat)}</td></tr>
          ))}
        </tbody></table>
        <table className="totals" style={{ marginTop: 16 }}><tbody>
          <tr><td>Neto</td><td style={{ textAlign: 'right' }}>{money(inv.net)}</td></tr>
          <tr><td>TVSH {qty(inv.vat_rate)}%</td><td style={{ textAlign: 'right' }}>{money(inv.vat)}</td></tr>
          <tr><td><strong>Për pagesë</strong></td><td style={{ textAlign: 'right' }}><strong>{money(inv.gross)}</strong></td></tr>
          <tr><td>E papaguar</td><td style={{ textAlign: 'right' }}>{money(inv.open_amount)}</td></tr>
        </tbody></table>
        {inv.creditNotes.length > 0 && (<>
          <h2 style={{ marginTop: 24 }}>Nota krediti</h2>
          <table><thead><tr><th>Nr.</th><th>Data</th><th>Arsyeja</th><th>Malli u kthye në stok</th><th style={{ textAlign: 'right' }}>Vlera</th></tr></thead><tbody>
            {inv.creditNotes.map((c) => <tr key={c.id}><td>{c.credit_no}/{c.fiscal_year}</td><td>{c.credit_date}</td><td>{c.reason}</td><td>{c.restocked ? 'Po' : 'Jo'}</td><td style={{ textAlign: 'right' }}>−{money(c.gross)}</td></tr>)}
          </tbody></table>
        </>)}
        <div className="no-print card" style={{ marginTop: 24 }}>
          <h2>Kthim malli / notë krediti</h2>
          {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}
          {inv.lines.map((l) => {
            const left = decSub(l.qty, l.qty_credited);
            return (<div className="row" key={l.line_no} style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 3, minWidth: 200, paddingBottom: 10 }}>{l.sku} — {l.name} <span className="muted">(mund të kthehen deri në {qty(left)})</span></div>
              <div style={{ flex: 1, minWidth: 110 }}><label htmlFor={`ret${l.line_no}`}>Sasia e kthyer</label><input id={`ret${l.line_no}`} inputMode="decimal" value={ret[l.line_no] ?? ''} onChange={(e) => setRet({ ...ret, [l.line_no]: e.target.value })} disabled={left === '0'} /></div>
            </div>);
          })}
          <label htmlFor="retreason">Arsyeja</label><input id="retreason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Malli kthehet në stok (i padëmtuar)</label>
            <button onClick={requestCredit} disabled={reason.trim().length < 5}>Kërko notë krediti</button>
          </div>
        </div>
        {inv.is_provisional_tax && <p className="muted" style={{ marginTop: 24 }}>TVSH-ja është llogaritur me normë provizore, të pamiratuar nga kontabilisti. Ky dokument nuk është fiskalizuar.</p>}
      </div>
    )}
  </>);
}
