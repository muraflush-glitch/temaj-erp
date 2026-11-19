'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Me, tokenStore } from '@/lib/api';

export function Nav({ me }: { me: Me | null }) {
  const router = useRouter();
  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    tokenStore.clear();
    router.replace('/hyrja');
  }
  return (
    <header className="top">
      <strong>Temaj ERP</strong>
      <Link href="/">Paneli</Link>
      <Link href="/shitjet">Shitjet</Link>
      <Link href="/klientet">Klientët</Link>
      <Link href="/arka">Arka</Link>
      <Link href="/blerjet">Blerjet</Link>
      <Link href="/stoku">Stoku</Link>
      <Link href="/produktet">Produktet</Link>
      <Link href="/libri">Libri kryesor</Link>
      <Link href="/raportet">Raportet</Link>
      <Link href="/aprovimet">Aprovimet</Link>
      <Link href="/perdoruesit">Përdoruesit</Link>
      <Link href="/siguria">Siguria</Link>
      <span className="grow" />
      {me && <span>{me.displayName}</span>}
      <button className="secondary" onClick={logout}>Dil</button>
    </header>
  );
}
