'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, ApiError, tokenStore } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password, totp: needMfa ? totp : undefined } });
      tokenStore.set(res.token);
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') setNeedMfa(true);
      setError(err instanceof Error ? err.message : 'Gabim');
    } finally { setBusy(false); }
  }

  return (
    <main className="login">
      <div className="card">
        <h1>Hyrja në Temaj ERP</h1>
        <form onSubmit={submit}>
          <label htmlFor="email">Email-i</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="pw">Fjalëkalimi</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {needMfa && (<>
            <label htmlFor="totp">Kodi 2FA (6 shifra)</label>
            <input id="totp" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} required />
          </>)}
          <div style={{ marginTop: 16 }}><button disabled={busy}>{busy ? 'Duke hyrë…' : 'Hyr'}</button></div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </div>
    </main>
  );
}
