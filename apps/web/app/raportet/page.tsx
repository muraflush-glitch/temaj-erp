'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { money, qty } from '@/lib/util';
import { Nav } from '../Nav';

interface SalesRow { branch: string; branch_name: string; invoices: number; invoiced_net: string; credit_notes: number; credited_net: string; net_sales: string; gross_sales: string }
interface RecRow { code: string; name: string; credit_limit: string; total: string; not_due: string | null; d1_30: string | null; d31_60: string | null; d61_90: string | null; d90_plus: string | null; owed_to_customer: string | null }
interface PayRow { code: string; name: string; invoices: number; total: string; oldest_invoice: string }
interface StockRow { warehouse: string; sku: string; name: string; base_uom: string; received: string; dispatched: string; returned: string; transfer_in: string; transfer_out: string; adjustments: string }
const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const m = (s: string | null): string => (s == null ? '—' : money(s));
const R = { textAlign: 'right' as const };

export default function ReportsPage() {
  const { me } = useMe();
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))));
  const [to, setTo] = useState(iso(now));
  const [sales, setSales] = useState<{ rows: SalesRow[]; note: string } | null>(null);
  const [rec, setRec] = useState<RecRow[]>([]);
  const [pay, setPay] = useState<PayRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setError(null);
    api<{ rows: SalesRow[]; note: string }>(`/reports/sales?from=${from}&to=${to}`).then(setSales).catch((e: Error) => setError(e.message));
    api<StockRow[]>(`/reports/stock-movements?from=${from}&to=${to}`).then(setStock).catch(() => undefined);
    api<RecRow[]>('/reports/receivables').then(setRec).catch(() => undefined);
    api<PayRow[]>('/reports/payables').then(setPay).catch(() => undefined);
  }, [me, from, to]);

  return (<>
    <Nav me={me} />
    <main>
      <h1>Raportet</h1>
      {error && <div className="card"><span className="error" role="alert">{error}</span></div>}
      <div className="card">
        <div className="row">
          <div><label htmlFor="rfrom">Nga data</label><input id="rfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="rto">Deri më</label><input id="rto" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>
      <div className="card">
        <h2>Shitjet sipas degës</h2>
        <table><thead><tr><th>Dega</th><th style={R}>Fatura</th><th style={R}>Faturuar neto</th><th style={R}>Nota krediti</th><th style={R}>Kredituar neto</th><th style={R}>Shitje neto</th><th style={R}>Shitje me TVSH</th></tr></thead><tbody>
          {sales?.rows.map((r) => (
            <tr key={r.branch}><td>{r.branch_name}</td><td style={R}>{r.invoices}</td><td style={R}>{money(r.invoiced_net)}</td><td style={R}>{r.credit_notes}</td>
              <td style={R}>{money(r.credited_net)}</td><td style={R}><strong>{money(r.net_sales)}</strong></td><td style={R}>{money(r.gross_sales)}</td></tr>
          ))}
        </tbody></table>
        {sales && <p className="muted">{sales.note}</p>}
      </div>
      <div className="card">
        <h2>Borxhet e klientëve sipas vjetërsisë</h2>
        {rec.length === 0 ? <p className="muted">Asnjë borxh i hapur.</p> : (
          <table><thead><tr><th>Klienti</th><th style={R}>Gjithsej</th><th style={R}>Brenda afatit</th><th style={R}>1–30 ditë</th><th style={R}>31–60</th><th style={R}>61–90</th><th style={R}>Mbi 90</th><th style={R}>I detyrohemi</th><th style={R}>Limiti</th></tr></thead><tbody>
            {rec.map((r) => (
              <tr key={r.code}><td>{r.name}</td><td style={R}><strong>{money(r.total)}</strong></td><td style={R}>{m(r.not_due)}</td><td style={R}>{m(r.d1_30)}</td><td style={R}>{m(r.d31_60)}</td>
                <td style={R}>{m(r.d61_90)}</td><td style={R} className={r.d90_plus ? 'error' : ''}>{m(r.d90_plus)}</td><td style={R}>{m(r.owed_to_customer)}</td><td style={R}>{money(r.credit_limit)}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      <div className="card">
        <h2>Detyrimet ndaj furnitorëve</h2>
        {pay.length === 0 ? <p className="muted">Asnjë detyrim i hapur.</p> : (
          <table><thead><tr><th>Furnitori</th><th style={R}>Fatura të hapura</th><th style={R}>Gjithsej</th><th>Fatura më e vjetër</th></tr></thead><tbody>
            {pay.map((r) => <tr key={r.code}><td>{r.name}</td><td style={R}>{r.invoices}</td><td style={R}><strong>{money(r.total)}</strong></td><td>{r.oldest_invoice}</td></tr>)}
          </tbody></table>
        )}
      </div>
      <div className="card">
        <h2>Lëvizjet e stokut</h2>
        {stock.length === 0 ? <p className="muted">Asnjë lëvizje në këtë periudhë.</p> : (
          <table><thead><tr><th>Magazina</th><th>Produkti</th><th style={R}>Hyrje</th><th style={R}>Dalje</th><th style={R}>Kthime</th><th style={R}>Transfer hyrje</th><th style={R}>Transfer dalje</th><th style={R}>Korrigjime</th></tr></thead><tbody>
            {stock.map((r) => (
              <tr key={`${r.warehouse}-${r.sku}`}><td>{r.warehouse}</td><td>{r.sku} — {r.name} <span className="muted">({UOM[r.base_uom]})</span></td><td style={R}>{qty(r.received)}</td><td style={R}>{qty(r.dispatched)}</td>
                <td style={R}>{qty(r.returned)}</td><td style={R}>{qty(r.transfer_in)}</td><td style={R}>{qty(r.transfer_out)}</td><td style={R}>{qty(r.adjustments)}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </main>
  </>);
}
