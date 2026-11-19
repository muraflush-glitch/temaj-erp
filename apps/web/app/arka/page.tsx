'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { money, parseNum } from '@/lib/util';
import { Nav } from '../Nav';

interface Register { id: string; code: string; name: string; branch: string; session_id: string | null; session_status: string | null; opening_float: string | null; expected_now: string | null; payments: number }
interface Session { id: string; status: string; opened_at: string; closed_at: string | null; opening_float: string; expected: string | null; counted: string | null; difference: string | null; bank_deposit: string | null; close_reason: string | null }
const STATUS: Record<string, string> = { OPEN: 'E hapur', PENDING_CLOSE: 'Pret aprovimin e diferencës', CLOSED: 'E mbyllur' };

export default function CashPage() {
  const { me } = useMe();
  const [registers, setRegisters] = useState<Register[]>([]);
  const [history, setHistory] = useState<Record<string, Session[]>>({});
  const [counted, setCounted] = useState(''); const [deposit, setDeposit] = useState('0'); const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const regs = await api<Register[]>('/cash/registers').catch(() => [] as Register[]);
    setRegisters(regs);
    const h: Record<string, Session[]> = {};
    for (const r of regs) h[r.id] = await api<Session[]>(`/cash/registers/${r.id}/sessions`).catch(() => []);
    setHistory(h);
  }, []);
  useEffect(() => { if (me) void load(); }, [me, load]);

  async function run(fn: () => Promise<string>) {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gabim' }); }
    await load();
  }
  const open = (r: Register) => run(async () => {
    const s = await api<{ openingFloat: string }>(`/cash/registers/${r.id}/open`, { method: 'POST' });
    return `${r.name} u hap me ${money(s.openingFloat)} gjendje fillestare.`;
  });
  const close = (r: Register) => run(async () => {
    const res = await api<{ status: string; expected: string; difference: string }>(`/cash/sessions/${r.session_id}/close`, { method: 'POST',
      body: { counted: parseNum(counted), bankDeposit: parseNum(deposit) || '0', reason: reason.trim() || undefined } });
    setCounted(''); setDeposit('0'); setReason('');
    return res.status === 'CLOSED' ? `Arka u mbyll pa diferencë (${money(res.expected)}).`
      : `Diferenca ${money(res.difference)} u dërgua për aprovim. Arka mbetet e bllokuar deri në vendim.`;
  });

  return (<>
    <Nav me={me} />
    <main>
      <h1>Arka</h1>
      {msg && <div className="card" role="status"><span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span></div>}
      {registers.length === 0 && <div className="card"><p className="muted">Nuk keni qasje në asnjë arkë.</p></div>}
      {registers.map((r) => (
        <div className="card" key={r.id}>
          <h2>{r.name} <span className="badge">{r.session_status ? STATUS[r.session_status] : 'E mbyllur'}</span></h2>
          {!r.session_id && <button onClick={() => open(r)}>Hap arkën</button>}
          {r.session_status === 'OPEN' && (<>
            <p>Gjendja fillestare: <strong>{money(r.opening_float ?? '0')}</strong> · Arkëtime sot: <strong>{r.payments}</strong> · Duhet të jenë në arkë: <strong>{money(r.expected_now ?? '0')}</strong></p>
            <div className="row">
              <div style={{ flex: 1, minWidth: 150 }}><label htmlFor={`c${r.id}`}>Paratë e numëruara (€)</label><input id={`c${r.id}`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
              <div style={{ flex: 1, minWidth: 150 }}><label htmlFor={`d${r.id}`}>Dorëzohen në bankë (€)</label><input id={`d${r.id}`} inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></div>
              <div style={{ flex: 2, minWidth: 220 }}><label htmlFor={`r${r.id}`}>Arsyetimi (vetëm nëse ka mungesë ose tepricë)</label><input id={`r${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 12 }}><button onClick={() => close(r)} disabled={!counted.trim()}>Mbyll arkën</button></div>
          </>)}
          {r.session_status === 'PENDING_CLOSE' && <p className="muted">Mbyllja pret aprovimin e diferencës. Nuk mund të arkëtohet derisa të vendoset.</p>}
          {(history[r.id]?.length ?? 0) > 0 && (
            <table style={{ marginTop: 12 }}><thead><tr><th>Hapur</th><th>Statusi</th><th style={{ textAlign: 'right' }}>Fillimi</th><th style={{ textAlign: 'right' }}>Pritur</th><th style={{ textAlign: 'right' }}>Numëruar</th><th style={{ textAlign: 'right' }}>Diferenca</th><th style={{ textAlign: 'right' }}>Në bankë</th><th>Arsyetimi</th></tr></thead><tbody>
              {history[r.id]?.map((s) => (
                <tr key={s.id}><td>{new Date(s.opened_at).toLocaleString('sq-AL')}</td><td>{STATUS[s.status]}</td><td style={{ textAlign: 'right' }}>{money(s.opening_float)}</td>
                  <td style={{ textAlign: 'right' }}>{s.expected ? money(s.expected) : '—'}</td><td style={{ textAlign: 'right' }}>{s.counted ? money(s.counted) : '—'}</td>
                  <td style={{ textAlign: 'right' }} className={s.difference && Number(s.difference) !== 0 ? 'error' : ''}>{s.difference ? money(s.difference) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{s.bank_deposit ? money(s.bank_deposit) : '—'}</td><td className="muted">{s.close_reason ?? ''}</td></tr>
              ))}
            </tbody></table>
          )}
        </div>
      ))}
    </main>
  </>);
}
