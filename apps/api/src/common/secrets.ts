import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Enkriptim AES-256-GCM për sekrete në databazë (p.sh. çelësat 2FA).
 * Çelësat vijnë nga mjedisi: SECRET_KEYS="id1:<base64 32 bajt>,id2:<...>" dhe SECRET_ACTIVE_KEY_ID=id2.
 * Në Production çelësat duhet të vijnë nga KMS/HSM (detyrë e hapur te ADR-002), jo nga skedarë .env.
 * Rrotullimi: shtoni çelës të ri, ndryshoni SECRET_ACTIVE_KEY_ID; të vjetrit mbeten për dekriptim.
 */
function loadKeys(): { active: string; keys: Map<string, Buffer> } {
  const raw = process.env.SECRET_KEYS;
  const active = process.env.SECRET_ACTIVE_KEY_ID;
  if (!raw || !active) throw new Error('SECRET_KEYS dhe SECRET_ACTIVE_KEY_ID duhet të vendosen');
  const keys = new Map<string, Buffer>();
  for (const part of raw.split(',')) {
    const idx = part.indexOf(':');
    const id = part.slice(0, idx).trim();
    const key = Buffer.from(part.slice(idx + 1).trim(), 'base64');
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(id) || key.length !== 32) throw new Error(`Çelës i pavlefshëm në SECRET_KEYS: ${id || '(pa id)'}`);
    keys.set(id, key);
  }
  if (!keys.has(active)) throw new Error('SECRET_ACTIVE_KEY_ID nuk gjendet te SECRET_KEYS');
  return { active, keys };
}

export function encryptSecret(plaintext: string, aad: string): string {
  const { active, keys } = loadKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.get(active) as Buffer, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', active, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/** `aad` lidh sekretin me pronarin (p.sh. user:42), që të mos kopjohet te një përdorues tjetër. */
export function decryptSecret(blob: string, aad: string): string {
  const [v, keyId, iv, tag, ct] = blob.split(':');
  if (v !== 'v1' || !keyId || !iv || !tag || !ct) throw new Error('Format i panjohur i sekretit');
  const key = loadKeys().keys.get(keyId);
  if (!key) throw new Error(`Çelësi ${keyId} nuk është i disponueshëm`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}
