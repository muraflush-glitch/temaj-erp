'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { newKey, parseNum, qty } from '@/lib/util';
import { Nav } from '../Nav';

interface Warehouse { id: string; code: string; name: string }
interface Row { sku: string; name: string; base_uom: string; lot_code: string | null; shade: string | null; caliber: string | null; on_hand: string; reserved: string; available: string; full_boxes: string | null; loose_pieces: string | null }
interface Product { sku: string; name: string; base_uom: string; tracks_lot: boolean; qty_step: string | null }
interface Transfer { id: string; status: string; document_ref: string; from_warehouse: string; to_warehouse: string; lines: { sku: string; qtyDispatched: string; qtyReceived: string | null }[] }

const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };
const STATUS: Record<string, string> = { IN_TRANSIT: 'Në rrugë', RECEIVED: 'Pranuar', DISCREPANCY: 'Me diferencë' };

export default function StockPage() {
  const { me } = useMe();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [wh, setWh] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api<Warehouse[]>('/org/warehouses').then((w) => { setWarehouses(w); setWh((cur) => cur || (w[0]?.id ?? '')); }).catch(() => undefined);
    api<Transfer[]>('/inventory/transfers').then(setTransfers).catch(() => undefined);
  }, [me]);

  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState({ sku: '', qty: '', lotCode: '', shade: '', caliber: '', documentRef: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadStock = useCallback(() => {
    if (!wh) return;
    setError(null);
    api<Row[]>(`/inventory/warehouses/${wh}/stock`).then(setRows).catch((e: Error) => { setRows([]); setError(e.message); });
  }, [wh]);
  useEffect(() => { loadStock(); }, [loadStock]);
  useEffect(() => {
    if (!me) return;
    api<Product[]>('/inventory/products').then((p) => { setProducts(p); setForm((f) => ({ ...f, sku: f.sku || (p[0]?.sku ?? '') })); }).catch(() => undefined);
  }, [me]);

  const product = products.find((p) => p.sku === form.sku);
  async function receive(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      await api('/inventory/receipts', { method: 'POST', body: {
        warehouseId: Number(wh), sku: form.sku, qty: parseNum(form.qty), documentRef: form.documentRef.trim(), idempotencyKey: newKey(),
        lot: product?.tracks_lot ? { lotCode: form.lotCode.trim(), shade: form.shade.trim(), caliber: form.caliber.trim() } : undefined } });
      setForm((f) => ({ ...f, qty: '', documentRef: '' })); setMsg({ ok: true, text: 'Hyrja u regjistrua.' }); loadStock();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Gabim' }); }
  }

  return (<>
    <Nav me={me} />
    <main>
      <h1>Stoku</h1>
      <div className="card"><strong>Prototip me produkte testuese.</strong> <span className="muted">Vetëm sasi; vlera e stokut pret metodën e miratuar nga kontabilisti (OPEN-03).</span></div>
      <div className="card">
        <h2>Gjendja sipas magazinës</h2>
        <div className="row">
          {warehouses.map((w) => <button key={w.id} className={w.id === wh ? '' : 'secondary'} onClick={() => setWh(w.id)}>{w.name}</button>)}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {!error && rows.length === 0 && <p className="muted">Nuk ka stok në këtë magazinë.</p>}
        {rows.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Kodi</th><th>Produkti</th><th>Loti</th><th>Nuanca</th><th>Kalibri</th><th style={{ textAlign: 'right' }}>Sasia</th><th style={{ textAlign: 'right' }}>Rezervuar</th><th style={{ textAlign: 'right' }}>E lirë</th><th style={{ textAlign: 'right' }}>Kuti</th><th style={{ textAlign: 'right' }}>Copë të lira</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.sku}-${r.lot_code}-${r.shade}-${r.caliber}`}><td>{r.sku}</td><td>{r.name}</td><td>{r.lot_code ?? '—'}</td><td>{r.shade || '—'}</td><td>{r.caliber || '—'}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.on_hand)} {UOM[r.base_uom]}</td><td style={{ textAlign: 'right' }}>{qty(r.reserved)}</td><td style={{ textAlign: 'right' }}>{qty(r.available)}</td><td style={{ textAlign: 'right' }}>{r.full_boxes ?? '—'}</td><td style={{ textAlign: 'right' }}>{r.loose_pieces ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Hyrje malli</h2>
        {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}
        <form onSubmit={receive}>
          <div className="row">
            <div style={{ flex: 2, minWidth: 220 }}><label htmlFor="rsku">Produkti</label>
              <select id="rsku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}>{products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}</select></div>
            <div style={{ flex: 1, minWidth: 110 }}><label htmlFor="rqty">Sasia ({UOM[product?.base_uom ?? 'PIECE']})</label><input id="rqty" inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required /></div>
            <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="rdoc">Nr. i dokumentit</label><input id="rdoc" value={form.documentRef} onChange={(e) => setForm({ ...form, documentRef: e.target.value })} required /></div>
          </div>
          {product?.tracks_lot && (
            <div className="row">
              <div style={{ flex: 1, minWidth: 120 }}><label htmlFor="rlot">Loti</label><input id="rlot" value={form.lotCode} onChange={(e) => setForm({ ...form, lotCode: e.target.value })} required /></div>
              <div style={{ flex: 1, minWidth: 120 }}><label htmlFor="rshade">Nuanca</label><input id="rshade" value={form.shade} onChange={(e) => setForm({ ...form, shade: e.target.value })} /></div>
              <div style={{ flex: 1, minWidth: 120 }}><label htmlFor="rcal">Kalibri</label><input id="rcal" value={form.caliber} onChange={(e) => setForm({ ...form, caliber: e.target.value })} /></div>
            </div>
          )}
          {product?.qty_step && product.qty_step !== '1' && <p className="muted">Sasia duhet të jetë shumëfish i {qty(product.qty_step)} {UOM[product.base_uom]} (paketimi).</p>}
          <div style={{ marginTop: 12 }}><button disabled={!wh || !form.sku}>Regjistro hyrjen</button></div>
        </form>
      </div>
      <div className="card">
        <h2>Transferet</h2>
        {transfers.length === 0 ? <p className="muted">Asnjë transfer.</p> : (
          <table><thead><tr><th>#</th><th>Dokumenti</th><th>Nga</th><th>Te</th><th>Statusi</th><th>Rreshtat</th></tr></thead><tbody>
            {transfers.map((t) => (
              <tr key={t.id}><td>{t.id}</td><td>{t.document_ref}</td><td>{t.from_warehouse}</td><td>{t.to_warehouse}</td><td><span className="badge">{STATUS[t.status] ?? t.status}</span></td>
                <td className="muted">{t.lines.map((l) => `${l.sku}: ${qty(l.qtyDispatched)}${l.qtyReceived != null ? ` → ${qty(l.qtyReceived)}` : ''}`).join('; ')}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </main>
  </>);
}
