'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Me, tokenStore } from './api';

export function useMe(): { me: Me | null; reload: () => void } {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!tokenStore.get()) { router.replace('/hyrja'); return; }
    api<Me>('/auth/me').then(setMe).catch(() => router.replace('/hyrja'));
  }, [router, n]);
  return { me, reload: () => setN((x) => x + 1) };
}

export const can = (me: Me | null, p: string): boolean => !!me?.permissions.some((x) => x.permission === p);
