'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Nav } from '../Nav';

export default function SecurityPage() {
  const { me, reload } = useMe();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    setMsg(null);
    try { setSetup(await api('/auth/mfa/setup', { method: 'POST' })); } catch (e) { setMsg(e instanceof Error ? e.message : 'Gabim'); }
  }
  async function enable() {
    try { await api('/auth/mfa/enable', { method: 'POST', body: { code } }); setSetup(null); setMsg('2FA u aktivizua.'); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gabim'); }
  }

  return (<>
    <Nav me={me} />
    <main>
      <h1>Siguria e llogarisë</h1>
      <div className="card"><h2>Verifikimi me dy hapa (2FA)</h2>
        {me?.mfaEnabled ? <p className="ok">2FA është aktive.</p> : setup ? (<>
          <p>Shtoni këtë çelës në Google Authenticator ose Microsoft Authenticator, pastaj shkruani kodin 6-shifror.</p>
          <code className="secret">{setup.secret}</code>
          <label htmlFor="code">Kodi</label>
          <input id="code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <div style={{ marginTop: 12 }}><button onClick={enable}>Aktivizo</button></div>
        </>) : <button onClick={start}>Fillo aktivizimin e 2FA</button>}
        {msg && <p className="muted" role="status">{msg}</p>}
      </div>
    </main>
  </>);
}
