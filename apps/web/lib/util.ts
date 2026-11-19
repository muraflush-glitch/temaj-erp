/** Çelës unik për çdo veprim: i njëjti klikim i përsëritur nuk e kryen veprimin dy herë. */
export const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Zbritje e saktë e dy numrave dhjetorë (tekst), pa float: "5.7600" - "2.8800" = "2.88". */
export function decSub(a: string, b: string): string {
  const toInt = (s: string): bigint => {
    const [i = '0', f = ''] = s.split('.');
    return BigInt(i) * 10000n + BigInt((f + '0000').slice(0, 4));
  };
  const d = toInt(a) - toInt(b);
  const neg = d < 0n; const abs = neg ? -d : d;
  const frac = (abs % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / 10000n}${frac ? `.${frac}` : ''}`;
}

export const money = (s: string): string => {
  const neg = s.startsWith('-');
  const [int = '0', frac = ''] = s.replace('-', '').split('.');
  return `${neg ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(frac + '00').slice(0, 2)} €`;
};
export const qty = (s: string | null): string => (s ?? '0').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',') || '0';
/** Pranon presje ose pikë nga tastiera: "2,88" → "2.88". */
export const parseNum = (s: string): string => s.trim().replace(',', '.');
