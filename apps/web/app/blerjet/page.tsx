'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { decSub, money, newKey, parseNum, qty } from '@/lib/util';
import { Nav } from '../Nav';

interface Po { id: string; status: string; branch: string; supplier_name: string; created: string; total: string }
interface PoLine { line_no: number; sku: string; name: string; tracks_lot: boolean; qty: string; unit_cost: string; qty_received: string; qty_invoiced: string; total: string }
interface Detail { id: string; status: string; supplier_name: string; total: string; lines: PoLine[];
  invoices: { id: string; invoice_no: string; invoice_date: string; status: string; discrepancies: { lineNo: number; type: string }[] }[] }
interface Supplier { id: string; code: string; name: string }
interface Warehouse { id: string; branch_id: string; name: string }
interface Product { sku: string; name: string; base_uom: string }
interface DraftLine { sku: string; qty: string; unitCost: string }

const STATUS: Record<string, string> = { DRAFT: 'Draft', PENDING_APPROVAL: 'Pret aprovim', APPROVED: 'Aprovuar', PARTIALLY_RECEIVED: 'Pranuar pjesërisht', RECEIVED: 'Pranuar', CANCELLED: 'Anuluar' };
const DISC: Record<string, string> = { QTY_EXCEEDS_RECEIVED: 'sasia e faturuar kalon mallin e pranuar', PRICE_MISMATCH: 'çmimi ndryshon nga porosia', LINE_NOT_ON_ORDER: 'rreshti nuk është në porosi' };
const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };
const today = (): string => new Date().toISOString().slice(0, 10);

export default function PurchasingPage() {
  const { me } = useMe();
  const [orders, setOrders] = useState<Po[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sup, setSup] = useState({ code: '', name: '', country: '' });
  const [supplierId, setSupplierId] = useState(''); const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ sku: '', qty: '', unitCost: '' }]);
  const [reason, setReason] = useState(''); const [docRef, setDocRef] = useState('');
  const [lot, setLot] = useState({ lotCode: '', shade: '', caliber: '' });
  const [invNo, setInvNo] = useState(''); const [invDate, setInvDate] = useState(today());
  const [invLines, setInvLines] = useState<Record<number, { qty: string; unitCost: string }>>({});

  const load = useCallback(() => {
    api<Po[]>('/purchasing/orders').then(setOrders).catch(() => undefined);
    api<Supplier[]>('/purchasing/suppliers').then((s) => { setSuppliers(s); setSupplierId((x) => x || (s[0]?.id ?? '')); }).catch(() => undefined);
  }, []);
  const open = useCallback(async (id: string) => {
    const d = await api<Detail>(`/purchasing/orders/${id}`);
    setDetail(d);
    // Fatura propozohet për mallin e pranuar dhe ende të pafaturuar, me çmimin e porosisë.
    setInvLines(Object.fromEntries(d.lines.map((l) => [l.line_no, { qty: decSub(l.qty_received, l.qty_invoiced), unitCost: l.unit_cost.replace(/0{2}$/, '') }])));
  }, []);

  useEffect(() => {
    if (!me) return;
    load();
    api<Warehouse[]>('/org/warehouses').then((w) => { setWarehouses(w); setWarehouseId((x) => x || (w[0]?.id ?? '')); }).catch(() => undefined);
    api<Product[]>('/inventory/products').then((p) => { setProducts(p); setLines((ls) => ls.map((l) => ({ ...l, sku: l.sku || (p[0]?.sku ?? '') }))); }).catch(() => undefined);
  }, [me, load]);

  async function run(fn: () => Promise<string>) {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); load(); if (detail) await open(detail.id); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gabim' }); }
  }

  const addSupplier = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/purchasing/suppliers', { method: 'POST', body: { code: sup.code.trim().toUpperCase(), name: sup.name.trim(), country: sup.country.trim() || undefined } });
    setSup({ code: '', name: '', country: '' }); return 'Furnitori u shtua.';
  }); };
  const createPo = (e: FormEvent) => { e.preventDefault(); const wh = warehouses.find((w) => w.id === warehouseId); if (!wh) return; void run(async () => {
    const r = await api<{ id: number }>('/purchasing/orders', { method: 'POST', body: { branchId: Number(wh.branch_id), warehouseId: Number(wh.id), supplierId: Number(supplierId), idempotencyKey: newKey(),
      lines: lines.filter((l) => l.qty.trim()).map((l) => ({ sku: l.sku, qty: parseNum(l.qty), unitCost: parseNum(l.unitCost) })) } });
    setLines([{ sku: products[0]?.sku ?? '', qty: '', unitCost: '' }]);
    await open(String(r.id)); return `Porosia e blerjes #${r.id} u krijua.`;
  }); };
  const submit = () => run(async () => {
    const r = await api<{ status: string }>(`/purchasing/orders/${detail?.id}/submit`, { method: 'POST', body: { reason: reason.trim() || undefined } });
    return r.status === 'APPROVED' ? 'Porosia u aprovua (nën pragun e aprovimit).' : 'Porosia u dërgua për aprovim.';
  });
  const receiveAll = () => run(async () => {
    const rest = (detail?.lines ?? []).map((l) => ({ lineNo: l.line_no, qty: decSub(l.qty, l.qty_received), lot: l.tracks_lot ? { lotCode: lot.lotCode.trim(), shade: lot.shade.trim(), caliber: lot.caliber.trim() } : undefined })).filter((l) => l.qty !== '0');
    const r = await api<{ status: string }>(`/purchasing/orders/${detail?.id}/receipts`, { method: 'POST', body: { documentRef: docRef.trim(), idempotencyKey: newKey(), lines: rest } });
    return `Malli u pranua dhe hyri në stok (${STATUS[r.status] ?? r.status}).`;
  });
  const enterInvoice = () => run(async () => {
    const ls = Object.entries(invLines).filter(([, v]) => v.qty.trim() && parseNum(v.qty) !== '0').map(([k, v]) => ({ lineNo: Number(k), qty: parseNum(v.qty), unitCost: parseNum(v.unitCost) }));
    const r = await api<{ status: string; discrepancies: { lineNo: number; type: string }[] }>(`/purchasing/orders/${detail?.id}/invoices`, { method: 'POST', body: { invoiceNo: invNo.trim(), invoiceDate: invDate, lines: ls } });
    setInvNo('');
    return r.status === 'MATCHED' ? 'Fatura përputhet me porosinë dhe pranimin.' : `Fatura u bllokua: ${r.discrepancies.map((d) => `rreshti ${d.lineNo} — ${DISC[d.type] ?? d.type}`).join('; ')}.`;
  });

  const canReceive = detail && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(detail.status);
  const needsLot = detail?.lines.some((l) => l.tracks_lot && decSub(l.qty, l.qty_received) !== '0');
  const canInvoice = detail && ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(detail.status);

  return (<>
    <Nav me={me} />
    <main>
      <h1>Blerjet</h1>
      <div className="card"><strong>Prototip.</strong> <span className="muted">Pa pagesa ndaj furnitorëve, kosto importi, valuta të huaja apo kontabilizim.</span></div>
      {msg && <div className="card" role="status"><span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span></div>}

      <div className="card">
        <h2>Furnitor i ri</h2>
        <form onSubmit={addSupplier}><div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 130 }}><label htmlFor="scode">Kodi</label><input id="scode" value={sup.code} onChange={(e) => setSup({ ...sup, code: e.target.value })} required /></div>
          <div style={{ flex: 2, minWidth: 200 }}><label htmlFor="sname">Emri</label><input id="sname" value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} required /></div>
          <div style={{ flex: 1, minWidth: 130 }}><label htmlFor="scountry">Shteti</label><input id="scountry" value={sup.country} onChange={(e) => setSup({ ...sup, country: e.target.value })} /></div>
          <button>Shto furnitorin</button>
        </div></form>
      </div>

      <div className="card">
        <h2>Porosi e re blerjeje</h2>
        {suppliers.length === 0 ? <p className="muted">Shtoni së pari një furnitor.</p> : (
          <form onSubmit={createPo}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="posup">Furnitori</label><select id="posup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></div>
              <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="powh">Magazina pranuese</label><select id="powh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
            </div>
            {lines.map((l, i) => (
              <div className="row" key={i}>
                <div style={{ flex: 3, minWidth: 220 }}><label htmlFor={`pp${i}`}>Produkti</label><select id={`pp${i}`} value={l.sku} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))}>{products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.name} ({UOM[p.base_uom]})</option>)}</select></div>
                <div style={{ flex: 1, minWidth: 90 }}><label htmlFor={`pq${i}`}>Sasia</label><input id={`pq${i}`} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} required={i === 0} /></div>
                <div style={{ flex: 1, minWidth: 110 }}><label htmlFor={`pc${i}`}>Kostoja / njësi (€)</label><input id={`pc${i}`} inputMode="decimal" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} required={i === 0} /></div>
              </div>
            ))}
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setLines([...lines, { sku: products[0]?.sku ?? '', qty: '', unitCost: '' }])}>+ Rresht</button>
              <button>Krijo porosinë</button>
            </div>
          </form>
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

          {detail.status === 'DRAFT' && (<>
            <label htmlFor="poreason">Arsyetimi (kërkohet vetëm mbi pragun e aprovimit)</label>
            <input id="poreason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div style={{ marginTop: 12 }}><button onClick={submit}>Dërgo porosinë</button></div>
          </>)}

          {canReceive && (<>
            <h2 style={{ marginTop: 16 }}>Pranimi i mallit</h2>
            <div className="row">
              <div style={{ flex: 1, minWidth: 150 }}><label htmlFor="grdoc">Nr. i dokumentit (CMR / fletëdërgesë)</label><input id="grdoc" value={docRef} onChange={(e) => setDocRef(e.target.value)} /></div>
              {needsLot && (<>
                <div style={{ flex: 1, minWidth: 120 }}><label htmlFor="grlot">Loti</label><input id="grlot" value={lot.lotCode} onChange={(e) => setLot({ ...lot, lotCode: e.target.value })} /></div>
                <div style={{ flex: 1, minWidth: 100 }}><label htmlFor="grshade">Nuanca</label><input id="grshade" value={lot.shade} onChange={(e) => setLot({ ...lot, shade: e.target.value })} /></div>
                <div style={{ flex: 1, minWidth: 100 }}><label htmlFor="grcal">Kalibri</label><input id="grcal" value={lot.caliber} onChange={(e) => setLot({ ...lot, caliber: e.target.value })} /></div>
              </>)}
            </div>
            <div style={{ marginTop: 12 }}><button onClick={receiveAll} disabled={!docRef.trim() || (needsLot && !lot.lotCode.trim())}>Prano mallin e mbetur</button></div>
          </>)}

          {canInvoice && (<>
            <h2 style={{ marginTop: 16 }}>Fatura e furnitorit</h2>
            <div className="row">
              <div style={{ flex: 1, minWidth: 150 }}><label htmlFor="sinv">Nr. i faturës</label><input id="sinv" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></div>
              <div style={{ flex: 1, minWidth: 150 }}><label htmlFor="sinvd">Data</label><input id="sinvd" type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></div>
            </div>
            {detail.lines.map((l) => (
              <div className="row" key={l.line_no}>
                <div style={{ flex: 3, minWidth: 200, alignSelf: 'flex-end', paddingBottom: 10 }}>{l.sku} — {l.name}</div>
                <div style={{ flex: 1, minWidth: 100 }}><label htmlFor={`iq${l.line_no}`}>Sasia e faturuar</label><input id={`iq${l.line_no}`} inputMode="decimal" value={invLines[l.line_no]?.qty ?? ''} onChange={(e) => setInvLines({ ...invLines, [l.line_no]: { qty: e.target.value, unitCost: invLines[l.line_no]?.unitCost ?? '' } })} /></div>
                <div style={{ flex: 1, minWidth: 100 }}><label htmlFor={`ic${l.line_no}`}>Çmimi në faturë (€)</label><input id={`ic${l.line_no}`} inputMode="decimal" value={invLines[l.line_no]?.unitCost ?? ''} onChange={(e) => setInvLines({ ...invLines, [l.line_no]: { qty: invLines[l.line_no]?.qty ?? '', unitCost: e.target.value } })} /></div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}><button onClick={enterInvoice} disabled={!invNo.trim()}>Regjistro faturën</button></div>
            {detail.invoices.length > 0 && (
              <table style={{ marginTop: 12 }}><thead><tr><th>Nr.</th><th>Data</th><th>Përputhja</th><th>Mospërputhjet</th></tr></thead><tbody>
                {detail.invoices.map((i) => (
                  <tr key={i.id}><td>{i.invoice_no}</td><td>{i.invoice_date}</td><td><span className="badge">{i.status === 'MATCHED' ? 'Përputhet' : 'E bllokuar'}</span></td>
                    <td className="muted">{i.discrepancies.map((d) => `Rreshti ${d.lineNo}: ${DISC[d.type] ?? d.type}`).join('; ') || '—'}</td></tr>
                ))}
              </tbody></table>
            )}
          </>)}
        </div>
      )}

      <div className="card">
        <h2>Porositë e blerjes</h2>
        {orders.length === 0 ? <p className="muted">Asnjë porosi.</p> : (
          <table><thead><tr><th>#</th><th>Data</th><th>Dega</th><th>Furnitori</th><th>Statusi</th><th style={{ textAlign: 'right' }}>Vlera</th><th /></tr></thead><tbody>
            {orders.map((o) => (
              <tr key={o.id}><td>{o.id}</td><td>{o.created}</td><td>{o.branch}</td><td>{o.supplier_name}</td><td><span className="badge">{STATUS[o.status] ?? o.status}</span></td>
                <td style={{ textAlign: 'right' }}>{money(o.total)}</td><td><button className="secondary" onClick={() => { void open(o.id); }}>Hap</button></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </main>
  </>);
}
