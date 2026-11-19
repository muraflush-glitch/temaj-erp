'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Nav } from '../Nav';

interface Warehouse { id: string; code: string; name: string }
interface Row { sku: string; name: string; base_uom: string; lot_code: string | null; shade: string | null; caliber: string | null; on_hand: string; full_boxes: string | null; loose_pieces: string | null }
interface Transfer { id: string; status: string; document_ref: string; from_warehouse: string; to_warehouse: string; lines: { sku: string; qtyDispatched: string; qtyReceived: string | null }[] }

const qty = (s: string): string => s.replace(/\.?0+$/, '').replace('.', ',');
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

  useEffect(() => {
    if (!wh) return;
    setError(null);
    api<Row[]>(`/inventory/warehouses/${wh}/stock`).then(setRows).catch((e: Error) => { setRows([]); setError(e.message); });
  }, [wh]);

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
            <thead><tr><th>Kodi</th><th>Produkti</th><th>Loti</th><th>Nuanca</th><th>Kalibri</th><th style={{ textAlign: 'right' }}>Sasia</th><th style={{ textAlign: 'right' }}>Kuti</th><th style={{ textAlign: 'right' }}>Copë të lira</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.sku}-${r.lot_code}-${r.shade}-${r.caliber}`}><td>{r.sku}</td><td>{r.name}</td><td>{r.lot_code ?? '—'}</td><td>{r.shade || '—'}</td><td>{r.caliber || '—'}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.on_hand)} {UOM[r.base_uom]}</td><td style={{ textAlign: 'right' }}>{r.full_boxes ?? '—'}</td><td style={{ textAlign: 'right' }}>{r.loose_pieces ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
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
