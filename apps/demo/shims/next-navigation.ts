// Navigimi për provën në shfletues: një faqe e vetme, me emrin e ekranit te pjesa "#..." e adresës.
import { useSyncExternalStore } from 'react';

/** "/" ↔ "#paneli", "/stoku" ↔ "#stoku", "/fatura/12" ↔ "#fatura-12" */
export const pathToHash = (path: string): string => {
  const p = path.replace(/^\/+|\/+$/g, '');
  return `#${p === '' ? 'paneli' : p.replace(/\//g, '-')}`;
};
export const hashToPath = (hash: string): string => {
  const h = hash.replace(/^#/, '');
  if (!h || h === 'paneli') return '/';
  const m = /^fatura-(\d+)$/.exec(h);
  return m ? `/fatura/${m[1]}` : `/${h}`;
};
const subscribe = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
export const usePath = (): string => useSyncExternalStore(subscribe, () => hashToPath(location.hash));
const go = (path: string) => { location.hash = pathToHash(path); };
const router = { push: go, replace: go, back: () => history.back() };
export const useRouter = () => router;
export function useParams<T extends Record<string, string>>(): T {
  const m = /^\/fatura\/(\d+)$/.exec(usePath());
  return (m ? { id: m[1] } : {}) as T;
}
