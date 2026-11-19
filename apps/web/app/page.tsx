'use client';
import { useEffect, useState } from 'react';
import { api, Branch } from '@/lib/api';
import { can, useMe } from '@/lib/useMe';
import { Nav } from './Nav';

export default function Dashboard() {
  const { me } = useMe();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [audit, setAudit] = useState<{ intact: boolean } | null>(null);

  useEffect(() => {
    if (!me) return;
    if (can(me, 'org.read')) api<Branch[]>('/org/branches').then(setBranches).catch(() => undefined);
    if (can(me, 'audit.read')) api<{ intact: boolean }>('/audit/verify').then(setAudit).catch(() => undefined);
  }, [me]);

  return (<>
    <Nav me={me} />
    <main>
      <h1>Paneli</h1>
      {me && !me.mfaEnabled && (
        <div className="card"><strong>Aktivizoni 2FA.</strong> <span className="muted">Pa 2FA nuk mund të aprovoni kërkesa. Shkoni te “Siguria”.</span></div>
      )}
      <div className="card">
        <h2>Degët</h2>
        {branches.length === 0 ? <p className="muted">Nuk keni leje për të parë degët.</p> : (
          <table><thead><tr><th>Kodi</th><th>Dega</th><th>Subjekti ligjor</th></tr></thead><tbody>
            {branches.map((b) => (
              <tr key={b.id}><td>{b.code}</td><td>{b.name}</td>
                <td>{b.legal_entity_name} {!b.legal_entity_verified && <span className="badge">pa verifikuar (OPEN-01)</span>}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      {audit && (
        <div className="card"><h2>Audit trail</h2>
          {audit.intact ? <p className="ok">Zinxhiri i auditit është i paprekur.</p> : <p className="error">Kujdes: u zbulua ndërhyrje në audit trail.</p>}
        </div>
      )}
      <div className="card"><h2>Lejet tuaja</h2>
        <ul>{me?.permissions.map((p) => <li key={`${p.permission}-${p.branch_id}`}>{p.permission} <span className="muted">{p.branch_id == null ? '(të gjitha degët)' : `(dega ${p.branch_id})`}</span></li>)}</ul>
      </div>
    </main>
  </>);
}
