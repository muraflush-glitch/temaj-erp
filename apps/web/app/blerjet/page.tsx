'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { money, qty } from '@/lib/util';
import { Nav } from '../Nav';

interface Po { id: string; status: string; branch: string; supplier_name: string; created: string; total: string }
interface Detail {
  id: string; status: string; supplier_name: string; total: string;
  lines: { line_no: number; sku: string; name: string; qty: string; unit_cost: string; qty_received: string; qty_invoiced: string; total: string }[];
  invoices: { id: string; invoice_no: string; invoice_date: string; status: string; discrepancies: { lineNo: number; type: string }[] }[];
}
const STATUS: Record<string, string> = { DRAFT: 'Draft', PENDING_APPROVAL: 'Pret aprovim', APPROVED: 'Aprovuar', PARTIALLY_RECEIVED: 'Pranuar pjesërisht', RECEIVED: 'Pranuar', CANCELLED: 'Anuluar' };
const DISC: Record<string, string> = { QTY_EXCEEDS_RECEIVED: 'sasia e faturuar kalon mallin e pranuar', PRICE_MISMATCH: 'çmimi ndryshon nga porosia', LINE_NOT_ON_ORDER: 'rreshti nuk është në porosi' };

export default function PurchasingPage() {
  const { me } = useMe();
  const [orders, setOrders] = useState<Po[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (me) api<Po[]>('/purchasing/orders').then(setOrders).catch((e: Error) => setError(e.message)); }, [me]);
  const open = (id: string) => api<Detail>(`/purchasing/orders/${id}`).then(setDetail).catch((e: Error) => setError(e.message));

  return (<>
    <Nav me={me} />
    <main>
      <h1>Blerjet</h1>
      <div className="card"><strong>Prototip.</strong> <span className="muted">Pa pagesa, kosto importi, valuta të huaja apo kontabilizim. Këto presin rregullat e miratuara.</span></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <h2>Porositë e blerjes</h2>
        {orders.length === 0 ? <p className="muted">Asnjë porosi.</p> : (
          <table><thead><tr><th>#</th><th>Data</th><th>Dega</th><th>Furnitori</th><th>Statusi</th><th style={{ textAlign: 'right' }}>Vlera</th><th /></tr></thead><tbody>
            {orders.map((o) => (
              <tr key={o.id}><td>{o.id}</td><td>{o.created}</td><td>{o.branch}</td><td>{o.supplier_name}</td><td><span className="badge">{STATUS[o.status] ?? o.status}</span></td>
                <td style={{ textAlign: 'right' }}>{money(o.total)}</td><td><button className="secondary" onClick={() => open(o.id)}>Hap</button></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      {detail && (
        <div className="card">
          <h2>Porosia #{detail.id} — {detail.supplier_name} <span className="badge">{STATUS[detail.status] ?? detail.status}</span></h2>
          <table><thead><tr><th>Produkti</th><th style={{ textAlign: 'right' }}>Porositur</th><th style={{ textAlign: 'right' }}>Pranuar</th><th style={{ textAlign: 'right' }}>Faturuar</th><th style={{ textAlign: 'right' }}>Kostoja</th><th style={{ textAlign: 'right' }}>Vlera</th></tr></thead><tbody>
            {detail.lines.map((l) => (
              <tr key={l.line_no}><td>{l.sku} — {l.name}</td><td style={{ textAlign: 'right' }}>{qty(l.qty)}</td><td style={{ textAlign: 'right' }}>{qty(l.qty_received)}</td>
                <td style={{ textAlign: 'right' }}>{qty(l.qty_invoiced)}</td><td style={{ textAlign: 'right' }}>{money(l.unit_cost)}</td><td style={{ textAlign: 'right' }}>{money(l.total)}</td></tr>
            ))}
            <tr><td colSpan={5}><strong>Gjithsej</strong></td><td style={{ textAlign: 'right' }}><strong>{money(detail.total)}</strong></td></tr>
          </tbody></table>
          <h2 style={{ marginTop: 16 }}>Faturat e furnitorit</h2>
          {detail.invoices.length === 0 ? <p className="muted">Asnjë faturë.</p> : (
            <table><thead><tr><th>Nr.</th><th>Data</th><th>Përputhja</th><th>Mospërputhjet</th></tr></thead><tbody>
              {detail.invoices.map((i) => (
                <tr key={i.id}><td>{i.invoice_no}</td><td>{i.invoice_date}</td>
                  <td><span className="badge">{i.status === 'MATCHED' ? 'Përputhet' : 'E bllokuar'}</span></td>
                  <td className="muted">{i.discrepancies.map((d) => `Rreshti ${d.lineNo}: ${DISC[d.type] ?? d.type}`).join('; ') || '—'}</td></tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}
    </main>
  </>);
}
