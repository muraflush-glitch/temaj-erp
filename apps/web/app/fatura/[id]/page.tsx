'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { money, qty } from '@/lib/util';
import { Nav } from '../../Nav';

interface Invoice {
  id: string; fiscal_year: number; invoice_no: string; invoice_date: string; due_date: string; vat_rate: string; net: string; vat: string; gross: string;
  is_provisional_tax: boolean; is_fiscalized: boolean; order_id: string; open_amount: string;
  customer_code: string; customer_name: string; customer_phone: string | null;
  branch_name: string; branch_city: string; seller_name: string; seller_tax_number: string | null; seller_verified: boolean;
  lines: { line_no: number; sku: string; name: string; base_uom: string; qty: string; unit_price: string; discount_pct: string; net: string; vat: string }[];
}
const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };

export default function InvoicePage() {
  const { me } = useMe();
  const params = useParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (me) api<Invoice>(`/sales/invoices/${params.id}`).then(setInv).catch((e: Error) => setError(e.message)); }, [me, params.id]);

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
        {inv.is_provisional_tax && <p className="muted" style={{ marginTop: 24 }}>TVSH-ja është llogaritur me normë provizore, të pamiratuar nga kontabilisti. Ky dokument nuk është fiskalizuar.</p>}
      </div>
    )}
  </>);
}
