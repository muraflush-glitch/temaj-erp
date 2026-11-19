'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { newKey } from '@/lib/util';
import { Nav } from '../Nav';

interface UserRow { id: string; email: string; display_name: string; is_active: boolean; mfa_enabled: boolean; roles: { userRoleId: number; role: string; branchId: number | null }[] }
interface Role { code: string; name: string }
interface Branch { id: string; code: string; name: string }

export default function UsersPage() {
  const { me } = useMe();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', password: '' });
  const [grant, setGrant] = useState({ userId: '', roleCode: '', branchId: '', reason: '' });

  const load = useCallback(() => {
    api<UserRow[]>('/access/users').then((u) => { setUsers(u); setGrant((g) => ({ ...g, userId: g.userId || (u[0]?.id ?? '') })); }).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);
  useEffect(() => {
    if (!me) return;
    load();
    api<Role[]>('/org/roles').then((r) => { setRoles(r); setGrant((g) => ({ ...g, roleCode: g.roleCode || (r[0]?.code ?? '') })); }).catch(() => undefined);
    api<Branch[]>('/org/branches').then(setBranches).catch(() => undefined);
  }, [me, load]);

  async function run(fn: () => Promise<string>) {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); load(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gabim' }); }
  }
  const create = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/access/users', { method: 'POST', body: { email: form.email.trim(), displayName: form.displayName.trim(), password: form.password } });
    setForm({ email: '', displayName: '', password: '' }); return 'Përdoruesi u krijua. Ende nuk ka asnjë rol.';
  }); };
  const requestGrant = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/access/role-grants', { method: 'POST', body: { userId: Number(grant.userId), roleCode: grant.roleCode, branchId: grant.branchId ? Number(grant.branchId) : null, reason: grant.reason.trim(), idempotencyKey: newKey() } });
    setGrant({ ...grant, reason: '' }); return 'Kërkesa për rol u dërgua për aprovim te një person tjetër.';
  }); };
  const revoke = (userRoleId: number) => run(async () => { await api(`/access/user-roles/${userRoleId}/revoke`, { method: 'POST', body: { reason: 'Hequr nga administratori' } }); return 'Roli u hoq menjëherë.'; });
  const deactivate = (id: string) => run(async () => { await api(`/access/users/${id}/deactivate`, { method: 'POST', body: { reason: 'Çaktivizuar nga administratori' } }); return 'Përdoruesi u çaktivizua dhe sesionet e tij u mbyllën.'; });
  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;
  const branchName = (id: number | null) => (id == null ? 'të gjitha degët' : branches.find((b) => Number(b.id) === id)?.name ?? `dega ${id}`);

  return (<>
    <Nav me={me} />
    <main>
      <h1>Përdoruesit dhe rolet</h1>
      {msg && <div className="card" role="status"><span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span></div>}
      <div className="card">
        <h2>Përdorues i ri</h2>
        <form onSubmit={create}><div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="uemail">Email-i</label><input id="uemail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div style={{ flex: 1, minWidth: 180 }}><label htmlFor="uname">Emri</label><input id="uname" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required minLength={2} /></div>
          <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="upw">Fjalëkalimi fillestar (min. 12 karaktere)</label><input id="upw" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} /></div>
          <button>Krijo përdoruesin</button>
        </div></form>
      </div>
      <div className="card">
        <h2>Jep rol</h2>
        <p className="muted">Çdo rol jepet vetëm pasi ta aprovojë një person tjetër. Heqja e rolit bëhet menjëherë.</p>
        <form onSubmit={requestGrant}><div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}><label htmlFor="guser">Përdoruesi</label><select id="guser" value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })}>{users.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 180 }}><label htmlFor="grole">Roli</label><select id="grole" value={grant.roleCode} onChange={(e) => setGrant({ ...grant, roleCode: e.target.value })}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 160 }}><label htmlFor="gbranch">Dega</label><select id="gbranch" value={grant.branchId} onChange={(e) => setGrant({ ...grant, branchId: e.target.value })}><option value="">Të gjitha degët</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div style={{ flex: 2, minWidth: 200 }}><label htmlFor="greason">Arsyetimi</label><input id="greason" value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} required minLength={5} /></div>
          <button>Kërko rolin</button>
        </div></form>
      </div>
      <div className="card">
        <h2>Lista</h2>
        <table><thead><tr><th>Emri</th><th>Email-i</th><th>2FA</th><th>Rolet</th><th /></tr></thead><tbody>
          {users.map((u) => (
            <tr key={u.id}><td>{u.display_name} {!u.is_active && <span className="badge">joaktiv</span>}</td><td>{u.email}</td><td>{u.mfa_enabled ? 'Po' : 'Jo'}</td>
              <td>{u.roles.length === 0 ? <span className="muted">asnjë</span> : u.roles.map((r) => (
                <div key={r.userRoleId}>{roleName(r.role)} <span className="muted">({branchName(r.branchId)})</span> <a href="#" onClick={(e) => { e.preventDefault(); void revoke(r.userRoleId); }}>hiq</a></div>
              ))}</td>
              <td>{u.is_active && Number(u.id) !== me?.id && <button className="danger" onClick={() => deactivate(u.id)}>Çaktivizo</button>}</td></tr>
          ))}
        </tbody></table>
      </div>
    </main>
  </>);
}
