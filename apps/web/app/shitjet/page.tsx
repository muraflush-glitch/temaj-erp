'use client';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { decSub, money, newKey, parseNum, qty } from '@/lib/util';
import { Nav } from '../Nav';

interface Order { id: string; status: string; order_date: string; branch: string; customer_name: string; total_net: string }
interface Line { line_no: number; sku: string; name: string; lot_code: string | null; shade: string | null; qty: string; unit_price: string; discount_pct: string; qty_delivered: string; qty_invoiced: string; net: string }
interface Detail { id: string; status: string; on_credit: boolean; customer_name: string; totalNet: string; taxNote: string; lines: Line[] }
interface Customer { id: string; code: string; name: string }
interface Warehouse { id: string; branch_id: string; code: string; name: string }
interface StockRow { sku: string; name: string; base_uom: string; lot_code: string | null; shade: string | null; caliber: string | null; available: string }
interface Invoice { id: string; fiscal_year: number; invoice_no: string; invoice_date: string; customer_name: string; gross: string; open_amount: string }
interface DraftLine { stockIdx: number; qty: string; discountPct: string }

const STATUS: Record<string, string> = { DRAFT: 'Ofertë', PENDING_APPROVAL: 'Pret aprovim', CONFIRMED: 'Konfirmuar', PARTIALLY_DELIVERED: 'Dorëzuar pjesërisht', DELIVERED: 'Dorëzuar', CANCELLED: 'Anuluar' };
const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };

export default function SalesPage() {
  const { me } = useMe();
  const [orders, setOrders] = useState<Order[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [onCredit, setOnCredit] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ stockIdx: 0, qty: '', discountPct: '0' }]);
  const [reason, setReason] = useState('');
  const [docRef, setDocRef] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const load = useCallback(() => {
    api<Order[]>('/sales/orders').then(setOrders).catch(() => undefined);
    api<Invoice[]>('/sales/invoices').then(setInvoices).catch(() => undefined);
  }, []);
  const open = useCallback((id: string) => api<Detail>(`/sales/orders/${id}`).then(setDetail).catch((e: Error) => setMsg({ ok: false, text: e.message })), []);

  useEffect(() => {
    if (!me) return;
    load();
    api<Customer[]>('/sales/customers').then((c) => { setCustomers(c); setCustomerId((x) => x || (c[0]?.id ?? '')); }).catch(() => undefined);
    api<Warehouse[]>('/org/warehouses').then((w) => { setWarehouses(w); setWarehouseId((x) => x || (w[0]?.id ?? '')); }).catch(() => undefined);
  }, [me, load]);

  const loadStock = useCallback(() => {
    if (!warehouseId) return;
    api<StockRow[]>(`/inventory/warehouses/${warehouseId}/stock`).then(setStock).catch(() => setStock([]));
  }, [warehouseId]);
  useEffect(() => { loadStock(); }, [loadStock]);

  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); load(); loadStock(); if (detail) await open(detail.id); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gabim' }); }
    finally { setBusy(false); }
  }

  async function createOffer(e: FormEvent) {
    e.preventDefault();
    const wh = warehouses.find((w) => w.id === warehouseId);
    if (!wh) return;
    await run(async () => {
      const res = await api<{ id: number }>('/sales/orders', { method: 'POST', body: {
        branchId: Number(wh.branch_id), warehouseId: Number(wh.id), customerId: Number(customerId), onCredit, idempotencyKey: newKey(),
        lines: lines.filter((l) => l.qty.trim()).map((l) => {
          const s = stock[l.stockIdx];
          if (!s) throw new Error('Zgjidhni produktin');
          return { sku: s.sku, qty: parseNum(l.qty), discountPct: parseNum(l.discountPct) || '0',
            lot: s.lot_code ? { lotCode: s.lot_code, shade: s.shade ?? '', caliber: s.caliber ?? '' } : undefined };
        }),
      } });
      setLines([{ stockIdx: 0, qty: '', discountPct: '0' }]);
      await open(String(res.id));
      return `Oferta #${res.id} u krijua.`;
    });
  }

  const confirm = () => run(async () => {
    const r = await api<{ status: string; exceptions: string[] }>(`/sales/orders/${detail?.id}/confirm`, { method: 'POST', body: { reason: reason || undefined } });
    return r.status === 'CONFIRMED' ? 'Porosia u konfirmua dhe malli u rezervua.' : `Porosia pret aprovim (${r.exceptions.join(', ')}).`;
  });
  const deliverAll = () => run(async () => {
    const rest = (detail?.lines ?? []).map((l) => ({ lineNo: l.line_no, qty: decSub(l.qty, l.qty_delivered) })).filter((l) => l.qty !== '0');
    const r = await api<{ status: string }>(`/sales/orders/${detail?.id}/deliveries`, { method: 'POST', body: { documentRef: docRef, idempotencyKey: newKey(), lines: rest } });
    return `Malli u dorëzua (${STATUS[r.status] ?? r.status}).`;
  });
  const invoice = () => run(async () => {
    const r = await api<{ invoiceNo: number; gross: string }>(`/sales/orders/${detail?.id}/invoices`, { method: 'POST', body: { idempotencyKey: newKey(), payment: detail?.on_credit ? undefined : { method: payMethod } } });
    return `Fatura nr. ${r.invoiceNo} u lëshua: ${money(r.gross)} me TVSH.`;
  });
  const cancel = () => run(async () => {
    await api(`/sales/orders/${detail?.id}/cancel`, { method: 'POST', body: { reason: reason || 'Anuluar nga përdoruesi' } });
    return 'Porosia u anulua.';
  });

  const canDeliver = detail && ['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(detail.status);
  const canInvoice = detail && detail.lines.some((l) => decSub(l.qty_delivered, l.qty_invoiced) !== '0');

  return (<>
    <Nav me={me} />
    <main>
      <h1>Shitjet</h1>
      <div className="card"><strong>Prototip me rregulla provizore.</strong> <span className="muted">TVSH-ja dhe llogaritë kontabël janë vlera të përkohshme, pa miratim nga kontabilisti. Faturat nuk janë fiskale.</span></div>
      {msg && <div className="card" role="status"><span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span></div>}

      <div className="card">
        <h2>Ofertë e re</h2>
        <form onSubmit={createOffer}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="cust">Klienti</label>
              <select id="cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select></div>
            <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="wh">Magazina</label>
              <select id="wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
          </div>
          {customers.length === 0 && <p className="muted">Nuk ka klientë. Shtoni një te faqja “Klientët”.</p>}
          {stock.length === 0 ? <p className="muted">Nuk ka stok në këtë magazinë. Regjistroni një hyrje malli te “Stoku”.</p> : lines.map((l, i) => (
            <div className="row" key={i} style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 3, minWidth: 220 }}><label htmlFor={`p${i}`}>Produkti (stoku i lirë)</label>
                <select id={`p${i}`} value={l.stockIdx} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stockIdx: Number(e.target.value) } : x)))}>
                  {stock.map((s, idx) => <option key={idx} value={idx}>{s.sku} — {s.name}{s.lot_code ? ` · ${s.lot_code}/${s.shade || '—'}` : ''} · {qty(s.available)} {UOM[s.base_uom]}</option>)}
                </select></div>
              <div style={{ flex: 1, minWidth: 90 }}><label htmlFor={`q${i}`}>Sasia</label>
                <input id={`q${i}`} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} required={i === 0} /></div>
              <div style={{ flex: 1, minWidth: 90 }}><label htmlFor={`d${i}`}>Zbritja %</label>
                <input id={`d${i}`} inputMode="decimal" value={l.discountPct} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, discountPct: e.target.value } : x)))} /></div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button type="button" className="secondary" onClick={() => setLines([...lines, { stockIdx: 0, qty: '', discountPct: '0' }])}>+ Rresht</button>
            <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} /> Shitje me kredi (pagesë më vonë)</label>
            <button disabled={busy || !customerId || stock.length === 0}>Krijo ofertën</button>
          </div>
        </form>
      </div>

      {detail && (
        <div className="card">
          <h2>Porosia #{detail.id} — {detail.customer_name} <span className="badge">{STATUS[detail.status] ?? detail.status}</span> {detail.on_credit && <span className="badge">me kredi</span>}</h2>
          <table><thead><tr><th>Produkti</th><th>Loti / nuanca</th><th style={{ textAlign: 'right' }}>Sasia</th><th style={{ textAlign: 'right' }}>Dorëzuar</th><th style={{ textAlign: 'right' }}>Faturuar</th><th style={{ textAlign: 'right' }}>Çmimi</th><th style={{ textAlign: 'right' }}>Zbritja</th><th style={{ textAlign: 'right' }}>Neto</th></tr></thead><tbody>
            {detail.lines.map((l) => (
              <tr key={l.line_no}><td>{l.sku} — {l.name}</td><td>{l.lot_code ? `${l.lot_code} / ${l.shade || '—'}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{qty(l.qty)}</td><td style={{ textAlign: 'right' }}>{qty(l.qty_delivered)}</td><td style={{ textAlign: 'right' }}>{qty(l.qty_invoiced)}</td>
                <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td><td style={{ textAlign: 'right' }}>{qty(l.discount_pct)}%</td><td style={{ textAlign: 'right' }}>{money(l.net)}</td></tr>
            ))}
            <tr><td colSpan={7}><strong>Gjithsej neto</strong></td><td style={{ textAlign: 'right' }}><strong>{money(detail.totalNet)}</strong></td></tr>
          </tbody></table>
          {detail.status === 'DRAFT' && (<>
            <label htmlFor="reason">Arsyetimi (vetëm nëse ka zbritje mbi limit, çmim të ndryshuar, përzierje nuancash ose tejkalim krediti)</label>
            <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row" style={{ marginTop: 12 }}><button onClick={confirm} disabled={busy}>Konfirmo porosinë</button><button className="danger" onClick={cancel} disabled={busy}>Anulo</button></div>
          </>)}
          {canDeliver && (<>
            <label htmlFor="doc">Numri i fletëdërgesës</label>
            <input id="doc" value={docRef} onChange={(e) => setDocRef(e.target.value)} />
            <div style={{ marginTop: 12 }}><button onClick={deliverAll} disabled={busy || !docRef.trim()}>Dorëzo mallin e mbetur</button></div>
          </>)}
          {canInvoice && (<>
            {!detail.on_credit && (<><label htmlFor="pm">Mënyra e pagesës</label>
              <select id="pm" value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'CASH' | 'BANK')}><option value="CASH">Para në dorë (arkë)</option><option value="BANK">Bankë</option></select></>)}
            <div style={{ marginTop: 12 }}><button onClick={invoice} disabled={busy}>{detail.on_credit ? 'Lësho faturën' : 'Lësho faturën dhe arkëto'}</button></div>
          </>)}
          <p className="muted">{detail.taxNote}</p>
        </div>
      )}

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
      <div className="card">
        <h2>Faturat</h2>
        {invoices.length === 0 ? <p className="muted">Asnjë faturë.</p> : (
          <table><thead><tr><th>Nr.</th><th>Data</th><th>Klienti</th><th style={{ textAlign: 'right' }}>Vlera</th><th style={{ textAlign: 'right' }}>E papaguar</th><th /></tr></thead><tbody>
            {invoices.map((i) => (
              <tr key={i.id}><td>{i.invoice_no}/{i.fiscal_year}</td><td>{i.invoice_date}</td><td>{i.customer_name}</td>
                <td style={{ textAlign: 'right' }}>{money(i.gross)}</td><td style={{ textAlign: 'right' }}>{money(i.open_amount)}</td>
                <td><Link href={`/fatura/${i.id}`}>Shiko / printo</Link></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </main>
  </>);
}
