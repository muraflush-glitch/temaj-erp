'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Nav } from '../Nav';

interface Order { id: string; status: string; order_date: string; branch: string; customer_name: string; total_net: string }
interface Line { line_no: number; sku: string; name: string; lot_code: string | null; shade: string | null; qty: string; unit_price: string; discount_pct: string; qty_delivered: string; net: string }
interface Detail { id: string; status: string; customer_name: string; totalNet: string; taxNote: string; lines: Line[] }

const STATUS: Record<string, string> = { DRAFT: 'Ofertë', PENDING_APPROVAL: 'Pret aprovim', CONFIRMED: 'Konfirmuar', PARTIALLY_DELIVERED: 'Dorëzuar pjesërisht', DELIVERED: 'Dorëzuar', CANCELLED: 'Anuluar' };
const money = (s: string): string => {
  const [int = '0', frac = ''] = s.split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(frac + '00').slice(0, 2)} €`;
};
const qty = (s: string): string => s.replace(/\.?0+$/, '').replace('.', ',');

export default function SalesPage() {
  const { me } = useMe();
  const [orders, setOrders] = useState<Order[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api<Order[]>('/sales/orders').then(setOrders).catch((e: Error) => setError(e.message));
  }, [me]);

  const open = (id: string) => api<Detail>(`/sales/orders/${id}`).then(setDetail).catch((e: Error) => setError(e.message));

  return (<>
    <Nav me={me} />
    <main>
      <h1>Shitjet</h1>
      <div className="card"><strong>Prototip.</strong> <span className="muted">Çmimet janë neto, pa TVSH. Faturimi dhe fiskalizimi presin rregullat e miratuara.</span></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <h2>Ofertat dhe porositë</h2>
        {orders.length === 0 ? <p className="muted">Asnjë porosi.</p> : (
          <table><thead><tr><th>#</th><th>Data</th><th>Dega</th><th>Klienti</th><th>Statusi</th><th style={{ textAlign: 'right' }}>Neto</th><th /></tr></thead><tbody>
            {orders.map((o) => (
              <tr key={o.id}><td>{o.id}</td><td>{o.order_date}</td><td>{o.branch}</td><td>{o.customer_name}</td>
                <td><span className="badge">{STATUS[o.status] ?? o.status}</span></td><td style={{ textAlign: 'right' }}>{money(o.total_net)}</td>
                <td><button className="secondary" onClick={() => open(o.id)}>Hap</button></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      {detail && (
        <div className="card">
          <h2>Porosia #{detail.id} — {detail.customer_name} <span className="badge">{STATUS[detail.status] ?? detail.status}</span></h2>
          <table><thead><tr><th>Produkti</th><th>Loti / nuanca</th><th style={{ textAlign: 'right' }}>Sasia</th><th style={{ textAlign: 'right' }}>Dorëzuar</th><th style={{ textAlign: 'right' }}>Çmimi</th><th style={{ textAlign: 'right' }}>Zbritja</th><th style={{ textAlign: 'right' }}>Neto</th></tr></thead><tbody>
            {detail.lines.map((l) => (
              <tr key={l.line_no}><td>{l.sku} — {l.name}</td><td>{l.lot_code ? `${l.lot_code} / ${l.shade || '—'}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{qty(l.qty)}</td><td style={{ textAlign: 'right' }}>{qty(l.qty_delivered) || '0'}</td>
                <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td><td style={{ textAlign: 'right' }}>{qty(l.discount_pct) || '0'}%</td><td style={{ textAlign: 'right' }}>{money(l.net)}</td></tr>
            ))}
            <tr><td colSpan={6}><strong>Gjithsej neto</strong></td><td style={{ textAlign: 'right' }}><strong>{money(detail.totalNet)}</strong></td></tr>
          </tbody></table>
          <p className="muted">{detail.taxNote}</p>
        </div>
      )}
    </main>
  </>);
}
