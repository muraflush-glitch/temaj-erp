'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { money, parseNum, qty } from '@/lib/util';
import { Nav } from '../Nav';

interface Product { sku: string; name: string; base_uom: string; pieces_per_box: number | null; m2_per_piece: string | null; allow_partial_box: boolean; tracks_lot: boolean; qty_step: string | null }
interface Price { sku: string; unit_price: string | null; valid_from: string | null }
const UOM: Record<string, string> = { M2: 'm²', PIECE: 'copë' };
const today = (): string => new Date().toISOString().slice(0, 10);

export default function ProductsPage() {
  const { me } = useMe();
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Record<string, Price>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ sku: '', name: '', baseUom: 'M2', piecesPerBox: '', m2PerPiece: '', allowPartialBox: false, tracksLot: true });
  const [price, setPrice] = useState({ sku: '', validFrom: today(), unitPrice: '' });

  const load = useCallback(() => {
    api<Product[]>('/inventory/products').then((p) => { setProducts(p); setPrice((x) => ({ ...x, sku: x.sku || (p[0]?.sku ?? '') })); }).catch((e: Error) => setMsg({ ok: false, text: e.message }));
    api<Price[]>('/sales/prices').then((p) => setPrices(Object.fromEntries(p.map((x) => [x.sku, x])))).catch(() => undefined);
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);

  async function run(fn: () => Promise<string>) {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); load(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gabim' }); }
  }
  const create = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/inventory/products', { method: 'POST', body: {
      sku: form.sku.trim().toUpperCase(), name: form.name.trim(), baseUom: form.baseUom, allowPartialBox: form.allowPartialBox, tracksLot: form.tracksLot,
      piecesPerBox: form.piecesPerBox.trim() ? Number(form.piecesPerBox) : undefined, m2PerPiece: form.m2PerPiece.trim() ? parseNum(form.m2PerPiece) : undefined } });
    setForm({ ...form, sku: '', name: '' }); return 'Produkti u shtua.';
  }); };
  const setNewPrice = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/sales/prices', { method: 'POST', body: { sku: price.sku, validFrom: price.validFrom, unitPrice: parseNum(price.unitPrice) } });
    setPrice({ ...price, unitPrice: '' }); return 'Çmimi u vendos.';
  }); };

  return (<>
    <Nav me={me} />
    <main>
      <h1>Produktet dhe çmimet</h1>
      {msg && <div className="card" role="status"><span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span></div>}
      <div className="card">
        <h2>Produkt i ri</h2>
        <form onSubmit={create}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 150 }}><label htmlFor="psku">Kodi (SKU)</label><input id="psku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required /></div>
            <div style={{ flex: 2, minWidth: 220 }}><label htmlFor="pname">Emri</label><input id="pname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div style={{ flex: 1, minWidth: 130 }}><label htmlFor="puom">Njësia bazë</label><select id="puom" value={form.baseUom} onChange={(e) => setForm({ ...form, baseUom: e.target.value, tracksLot: e.target.value === 'M2' })}><option value="M2">m² (pllaka)</option><option value="PIECE">copë</option></select></div>
          </div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="pppb">Copë për kuti</label><input id="pppb" inputMode="numeric" value={form.piecesPerBox} onChange={(e) => setForm({ ...form, piecesPerBox: e.target.value })} required={form.baseUom === 'M2'} /></div>
            {form.baseUom === 'M2' && <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="pm2">m² për copë (p.sh. 0,36)</label><input id="pm2" inputMode="decimal" value={form.m2PerPiece} onChange={(e) => setForm({ ...form, m2PerPiece: e.target.value })} required /></div>}
            <label style={{ alignSelf: 'flex-end', marginBottom: 12 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.allowPartialBox} onChange={(e) => setForm({ ...form, allowPartialBox: e.target.checked })} /> Lejohen kuti të hapura</label>
            <label style={{ alignSelf: 'flex-end', marginBottom: 12 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.tracksLot} onChange={(e) => setForm({ ...form, tracksLot: e.target.checked })} /> Ndiqet me lot / nuancë / kalibër</label>
          </div>
          <div style={{ marginTop: 12 }}><button>Shto produktin</button></div>
        </form>
      </div>
      <div className="card">
        <h2>Vendos çmim</h2>
        <p className="muted">Çmimi është neto, për njësinë bazë. Një çmim i vendosur nuk mbishkruhet: ndryshimi bëhet me datë të re.</p>
        <form onSubmit={setNewPrice}><div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 220 }}><label htmlFor="prsku">Produkti</label><select id="prsku" value={price.sku} onChange={(e) => setPrice({ ...price, sku: e.target.value })}>{products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="prdate">Vlen nga</label><input id="prdate" type="date" value={price.validFrom} onChange={(e) => setPrice({ ...price, validFrom: e.target.value })} /></div>
          <div style={{ flex: 1, minWidth: 120 }}><label htmlFor="prval">Çmimi (€)</label><input id="prval" inputMode="decimal" value={price.unitPrice} onChange={(e) => setPrice({ ...price, unitPrice: e.target.value })} required /></div>
          <button>Vendos çmimin</button>
        </div></form>
      </div>
      <div className="card">
        <h2>Lista</h2>
        <table><thead><tr><th>Kodi</th><th>Emri</th><th>Njësia</th><th>Paketimi</th><th>Shitet me hap</th><th>Lot</th><th style={{ textAlign: 'right' }}>Çmimi neto</th><th>Nga</th></tr></thead><tbody>
          {products.map((p) => (
            <tr key={p.sku}><td>{p.sku}</td><td>{p.name}</td><td>{UOM[p.base_uom]}</td>
              <td>{p.pieces_per_box ? `${p.pieces_per_box} copë/kuti${p.m2_per_piece ? ` · ${qty(p.m2_per_piece)} m²/copë` : ''}` : '—'}</td>
              <td>{p.qty_step ? `${qty(p.qty_step)} ${UOM[p.base_uom]}` : '—'}</td><td>{p.tracks_lot ? 'Po' : 'Jo'}</td>
              <td style={{ textAlign: 'right' }}>{prices[p.sku]?.unit_price ? money(prices[p.sku]?.unit_price ?? '0') : <span className="error">pa çmim</span>}</td><td>{prices[p.sku]?.valid_from ?? '—'}</td></tr>
          ))}
        </tbody></table>
      </div>
    </main>
  </>);
}
