import { base32Encode, hashPassword, totpAt, verifyPassword, verifyTotp } from '../src/auth/crypto';

describe('crypto', () => {
  it('TOTP përputhet me vektorin zyrtar të RFC 6238 (SHA-1, T=59s)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    // RFC 6238 jep 94287082 me 8 shifra; 6 shifrat e fundit janë 287082.
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1111111109_000)).toBe('081804');
  });

  it('TOTP pranon ±30 s por refuzon kode të vjetra', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 120_000), now)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false);
  });

  it('fjalëkalimet: hash i kripur, verifikim i saktë, refuzim i fjalëkalimeve të shkurtra', async () => {
    const h1 = await hashPassword('Nje-fjalekalim-i-gjate');
    const h2 = await hashPassword('Nje-fjalekalim-i-gjate');
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('Nje-fjalekalim-i-gjate', h1)).toBe(true);
    expect(await verifyPassword('gabim-gabim-gabim', h1)).toBe(false);
    await expect(hashPassword('shkurter')).rejects.toThrow();
  });
});
