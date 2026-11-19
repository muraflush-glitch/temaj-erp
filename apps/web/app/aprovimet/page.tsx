'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApprovalRequest } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Nav } from '../Nav';

const ACTION_LABELS: Record<string, string> = { 'access.grant_role': 'Dhënie roli', 'ledger.close_period': 'Mbyllje periudhe', 'stock.adjust': 'Korrigjim stoku', 'sales.order_exception': 'Përjashtim shitjeje', 'purchase.approve_po': 'Porosi blerjeje', 'cash.close_difference': 'Diferencë në arkë' };
const STATUS: Record<string, string> = { PENDING: 'Në pritje', APPROVED: 'Aprovuar', REJECTED: 'Refuzuar', CANCELLED: 'Anuluar' };

export default function ApprovalsPage() {
  const { me } = useMe();
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [mine, setMine] = useState<ApprovalRequest[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ApprovalRequest[]>('/approvals/pending').then(setPending).catch(() => undefined);
    api<ApprovalRequest[]>('/approvals/mine').then(setMine).catch(() => undefined);
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setMsg(null);
    try {
      const r = await api<{ status: string }>(`/approvals/${id}/decide`, { method: 'POST', body: { decision } });
      setMsg(`Kërkesa #${id}: ${STATUS[r.status] ?? r.status}`);
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Gabim'); }
  }

  return (<>
    <Nav me={me} />
    <main>
      <h1>Aprovimet</h1>
      {msg && <div className="card" role="status">{msg}</div>}
      <div className="card"><h2>Presin vendimin tuaj</h2>
        {pending.length === 0 ? <p className="muted">Asnjë kërkesë në pritje.</p> : (
          <table><thead><tr><th>#</th><th>Veprimi</th><th>Arsyeja</th><th>Detajet</th><th /></tr></thead><tbody>
            {pending.map((r) => (
              <tr key={r.id}><td>{r.id}</td><td>{ACTION_LABELS[r.action_code] ?? r.action_code}</td><td>{r.reason}</td>
                <td className="muted">{JSON.stringify(r.payload)}</td>
                <td><div className="row">
                  <button onClick={() => decide(r.id, 'APPROVE')} disabled={!me?.mfaPassed}>Aprovo</button>
                  <button className="danger" onClick={() => decide(r.id, 'REJECT')} disabled={!me?.mfaPassed}>Refuzo</button>
                </div></td></tr>
            ))}
          </tbody></table>
        )}
        {me && !me.mfaPassed && <p className="muted">Për të vendosur duhet të hyni me 2FA.</p>}
      </div>
      <div className="card"><h2>Kërkesat e mia</h2>
        {mine.length === 0 ? <p className="muted">Nuk keni bërë kërkesa.</p> : (
          <table><thead><tr><th>#</th><th>Veprimi</th><th>Statusi</th><th>Data</th></tr></thead><tbody>
            {mine.map((r) => <tr key={r.id}><td>{r.id}</td><td>{ACTION_LABELS[r.action_code] ?? r.action_code}</td><td>{STATUS[r.status] ?? r.status}</td><td>{new Date(r.created_at).toLocaleString('sq-AL')}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </main>
  </>);
}
