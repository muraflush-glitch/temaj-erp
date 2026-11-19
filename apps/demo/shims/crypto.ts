// Zëvendësim i modulit "crypto" të Node për shfletuesin, me të njëjtat algoritme (biblioteka @noble):
// scrypt, SHA-256, HMAC-SHA1 (TOTP), AES-256-GCM. Përdoret vetëm nga prova në shfletues.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { scrypt as nobleScrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

const bytes = (v: string | Uint8Array, enc: BufferEncoding = 'utf8'): Uint8Array => (typeof v === 'string' ? Buffer.from(v, enc) : v);

/** Buffer me mbështetje për 'base64url' (polyfill-i i shfletuesit nuk e ka). */
function out(u: Uint8Array): Buffer {
  const b = Buffer.from(u);
  const orig = b.toString.bind(b);
  (b as any).toString = (enc?: string, ...rest: any[]) =>
    enc === 'base64url' ? orig('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : orig(enc as BufferEncoding, ...rest);
  return b;
}

export function randomBytes(n: number): Buffer {
  const u = new Uint8Array(n); globalThis.crypto.getRandomValues(u); return out(u);
}

const ALGOS: Record<string, any> = { sha256, sha1 };
function hasher(make: () => any) {
  const h = make();
  const api = { update(d: string | Uint8Array) { h.update(bytes(d)); return api; }, digest(enc?: BufferEncoding) { const r = out(h.digest()); return enc ? r.toString(enc) : r; } };
  return api;
}
export const createHash = (algo: string) => hasher(() => ALGOS[algo].create());
export const createHmac = (algo: string, key: string | Uint8Array) => hasher(() => hmac.create(ALGOS[algo], bytes(key)));

export function scrypt(password: string, salt: Uint8Array, keylen: number, opts: { N: number; r: number; p: number }, cb: (e: unknown, key?: Buffer) => void): void {
  try { cb(null, out(nobleScrypt(bytes(password), salt, { N: opts.N, r: opts.r, p: opts.p, dkLen: keylen }))); } catch (e) { cb(e); }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let d = 0; for (let i = 0; i < a.length; i++) d |= (a[i] as number) ^ (b[i] as number);
  return d === 0;
}

// AES-256-GCM: Node e jep etiketën (16 bajt) veçmas; @noble e ngjit në fund të tekstit të enkriptuar.
export function createCipheriv(_algo: string, key: Uint8Array, iv: Uint8Array) {
  let aad: Uint8Array | undefined; const parts: Uint8Array[] = []; let tag: Uint8Array = new Uint8Array();
  return {
    setAAD(a: Uint8Array) { aad = a; },
    update(d: string | Uint8Array, enc?: BufferEncoding) { parts.push(bytes(d, enc)); return Buffer.alloc(0); },
    final() { const sealed = gcm(key, iv, aad).encrypt(Buffer.concat(parts)); tag = sealed.slice(sealed.length - 16); return out(sealed.slice(0, sealed.length - 16)); },
    getAuthTag() { return out(tag); },
  };
}
export function createDecipheriv(_algo: string, key: Uint8Array, iv: Uint8Array) {
  let aad: Uint8Array | undefined; let tag: Uint8Array = new Uint8Array(); const parts: Uint8Array[] = [];
  return {
    setAAD(a: Uint8Array) { aad = a; },
    setAuthTag(t: Uint8Array) { tag = t; },
    update(d: Uint8Array) { parts.push(d); return Buffer.alloc(0); },
    final() { return out(gcm(key, iv, aad).decrypt(Buffer.concat([...parts, tag]))); },
  };
}
