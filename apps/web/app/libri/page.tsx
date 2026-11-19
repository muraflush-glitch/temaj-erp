'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Nav } from '../Nav';

interface TbRow { code: string; name: string; type: string; debit: string; credit: string; balance: string }
interface Tb { asOf: string; accounts: TbRow[]; totalDebit: string; totalCredit: string }
interface Period { id: string; name: string; start_date: string; end_date: string; status: string }
interface Entry { id: string; entry_no: string | null; entry_date: string; description: string; status: string; total: string; reverses_entry_id: string | null }

// Shfaqje me dy shifra; vlera e saktë vjen si tekst dhjetor nga serveri, pa llogaritje me float.
const money = (s: string): string => {
  const neg = s.startsWith('-');
  const [int = '0', frac = ''] = s.replace('-', '').split('.');
  return `${neg ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(frac + '00').slice(0, 2)}`;
};
const today = (): string => new Date().toISOString().slice(0, 10);

export default function LedgerPage() {
  const { me } = useMe();
  const [asOf, setAsOf] = useState(today());
  const [tb, setTb] = useState<Tb | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setError(null);
    api<Tb>(`/ledger/trial-balance?asOf=${asOf}`).then(setTb).catch((e: Error) => { setTb(null); setError(e.message); });
    api<Period[]>('/ledger/periods').then(setPeriods).catch(() => undefined);
    api<Entry[]>('/ledger/entries?limit=50').then(setEntries).catch(() => undefined);
  }, [me, asOf]);

  return (<>
    <Nav me={me} />
    <main>
      <h1>Libri kryesor</h1>
      <div className="card">
        <strong>Prototip me llogari testuese.</strong>{' '}
        <span className="muted">Plani kontabël real pret miratimin e kontabilistit (OPEN-05).</span>
      </div>
      <div className="card">
        <h2>Bilanci vërtetues</h2>
        <label htmlFor="asof">Deri më datën</label>
        <input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ maxWidth: 220 }} />
        {error && <p className="error" role="alert">{error}</p>}
        {tb && (tb.accounts.length === 0 ? <p className="muted">Nuk ka regjistrime të postuara deri në këtë datë.</p> : (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Llogaria</th><th>Emri</th><th style={{ textAlign: 'right' }}>Debi</th><th style={{ textAlign: 'right' }}>Kredi</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
            <tbody>
              {tb.accounts.map((a) => (
                <tr key={a.code}><td>{a.code}</td><td>{a.name}</td>
                  <td style={{ textAlign: 'right' }}>{money(a.debit)}</td><td style={{ textAlign: 'right' }}>{money(a.credit)}</td><td style={{ textAlign: 'right' }}>{money(a.balance)}</td></tr>
              ))}
              <tr><td colSpan={2}><strong>Gjithsej</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{money(tb.totalDebit)}</strong></td><td style={{ textAlign: 'right' }}><strong>{money(tb.totalCredit)}</strong></td><td /></tr>
            </tbody>
          </table>
        ))}
      </div>
      <div className="card">
        <h2>Periudhat</h2>
        <table><thead><tr><th>Periudha</th><th>Nga</th><th>Deri</th><th>Statusi</th></tr></thead><tbody>
          {periods.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.start_date}</td><td>{p.end_date}</td><td><span className="badge">{p.status === 'OPEN' ? 'E hapur' : 'E mbyllur'}</span></td></tr>)}
        </tbody></table>
      </div>
      <div className="card">
        <h2>Regjistrimet e fundit</h2>
        {entries.length === 0 ? <p className="muted">Asnjë regjistrim.</p> : (
          <table><thead><tr><th>Nr.</th><th>Data</th><th>Përshkrimi</th><th>Statusi</th><th style={{ textAlign: 'right' }}>Shuma</th></tr></thead><tbody>
            {entries.map((e) => (
              <tr key={e.id}><td>{e.entry_no ?? '—'}</td><td>{e.entry_date}</td><td>{e.description}</td>
                <td><span className="badge">{e.status === 'POSTED' ? (e.reverses_entry_id ? 'Kthim' : 'Postuar') : 'Draft'}</span></td>
                <td style={{ textAlign: 'right' }}>{money(e.total)}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </main>
  </>);
}
