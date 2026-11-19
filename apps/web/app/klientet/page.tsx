'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { money, newKey, parseNum } from '@/lib/util';
import { Nav } from '../Nav';

interface Customer { id: string; code: string; name: string; kind: string; phone: string | null; credit_limit: string; payment_term_days: number }
interface Balance { creditLimit: string; openTotal: string; unappliedAdvances: string; openInvoices: { invoice_id: string; invoice_no: string; invoice_date: string; due_date: string; gross: string; open_amount: string; days_overdue: number }[] }
interface Branch { id: string; name: string }

export default function CustomersPage() {
  const { me } = useMe();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ code: '', name: '', kind: 'PERSON', phone: '' });
  const [pay, setPay] = useState({ branchId: '', method: 'CASH', amount: '', reference: '' });

  const load = useCallback(() => { api<Customer[]>('/sales/customers').then(setCustomers).catch((e: Error) => setMsg({ ok: false, text: e.message })); }, []);
  const openCustomer = useCallback((c: Customer) => { setSelected(c); api<Balance>(`/sales/customers/${c.id}/balance`).then(setBalance).catch(() => setBalance(null)); }, []);

  useEffect(() => {
    if (!me) return;
    load();
    api<Branch[]>('/org/branches').then((b) => { setBranches(b); setPay((p) => ({ ...p, branchId: p.branchId || (b[0]?.id ?? '') })); }).catch(() => undefined);
  }, [me, load]);

  async function create(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      await api('/sales/customers', { method: 'POST', body: { code: form.code.trim().toUpperCase(), name: form.name.trim(), kind: form.kind, phone: form.phone.trim() || undefined } });
      setForm({ code: '', name: '', kind: 'PERSON', phone: '' }); setMsg({ ok: true, text: 'Klienti u shtua.' }); load();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Gabim' }); }
  }

  async function receive(e: FormEvent) {
    e.preventDefault(); if (!selected) return; setMsg(null);
    try {
      const r = await api<{ allocated: string; advance: string }>(`/sales/customers/${selected.id}/payments`, { method: 'POST', body: {
        branchId: Number(pay.branchId), method: pay.method, amount: parseNum(pay.amount), reference: pay.reference.trim() || undefined, idempotencyKey: newKey() } });
      setPay((p) => ({ ...p, amount: '', reference: '' }));
      setMsg({ ok: true, text: `Arkëtimi u regjistrua: ${money(r.allocated)} për fatura${r.advance !== '0.00' ? `, ${money(r.advance)} si avans` : ''}.` });
      openCustomer(selected);
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Gabim' }); }
  }

  return (<>
    <Nav me={me} />
    <main>
      <h1>Klientët</h1>
      {msg && <div className="card" role="status"><span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span></div>}
      <div className="card">
        <h2>Klient i ri</h2>
        <form onSubmit={create}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="code">Kodi (p.sh. KL-001)</label><input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required pattern="[A-Za-z0-9\-]{2,30}" /></div>
            <div style={{ flex: 2, minWidth: 200 }}><label htmlFor="name">Emri</label><input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></div>
            <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="kind">Lloji</label><select id="kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="PERSON">Person</option><option value="COMPANY">Kompani</option></select></div>
            <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="phone">Telefoni</label><input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 12 }}><button>Shto klientin</button></div>
        </form>
      </div>
      <div className="card">
        <h2>Lista</h2>
        {customers.length === 0 ? <p className="muted">Asnjë klient.</p> : (
          <table><thead><tr><th>Kodi</th><th>Emri</th><th>Lloji</th><th>Telefoni</th><th style={{ textAlign: 'right' }}>Limiti i kreditit</th><th /></tr></thead><tbody>
            {customers.map((c) => (
              <tr key={c.id}><td>{c.code}</td><td>{c.name}</td><td>{c.kind === 'PERSON' ? 'Person' : 'Kompani'}</td><td>{c.phone ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{money(c.credit_limit)}</td><td><button className="secondary" onClick={() => openCustomer(c)}>Borxhi</button></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      {selected && balance && (
        <div className="card">
          <h2>{selected.name} — borxhi i hapur: {money(balance.openTotal)}</h2>
          {balance.unappliedAdvances !== '0.00' && balance.unappliedAdvances !== '0' && <p className="muted">Avans i pashfrytëzuar: {money(balance.unappliedAdvances)}</p>}
          {balance.openInvoices.length === 0 ? <p className="muted">Nuk ka fatura të hapura.</p> : (
            <table><thead><tr><th>Fatura</th><th>Data</th><th>Afati</th><th style={{ textAlign: 'right' }}>Vlera</th><th style={{ textAlign: 'right' }}>E papaguar</th><th style={{ textAlign: 'right' }}>Ditë vonesë</th></tr></thead><tbody>
              {balance.openInvoices.map((i) => (
                <tr key={i.invoice_id}><td>{i.invoice_no}</td><td>{i.invoice_date}</td><td>{i.due_date}</td><td style={{ textAlign: 'right' }}>{money(i.gross)}</td>
                  <td style={{ textAlign: 'right' }}>{money(i.open_amount)}</td><td style={{ textAlign: 'right' }}>{i.days_overdue}</td></tr>
              ))}
            </tbody></table>
          )}
          <h2 style={{ marginTop: 16 }}>Regjistro arkëtim</h2>
          <form onSubmit={receive}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="pb">Dega</label><select id="pb" value={pay.branchId} onChange={(e) => setPay({ ...pay, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="pmeth">Mënyra</label><select id="pmeth" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="CASH">Para në dorë</option><option value="BANK">Bankë</option></select></div>
              <div style={{ flex: 1, minWidth: 120 }}><label htmlFor="pamt">Shuma (€)</label><input id="pamt" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required /></div>
              <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="pref">Referenca</label><input id="pref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
            </div>
            <div style={{ marginTop: 12 }}><button>Regjistro arkëtimin</button></div>
          </form>
        </div>
      )}
    </main>
  </>);
}
