import { Buffer as B } from 'buffer';
// Variablat e mjedisit për provën lokale. Çelësi i enkriptimit krijohet rastësisht në çdo hapje: asgjë nuk del nga shfletuesi.
const key = new Uint8Array(32); crypto.getRandomValues(key);
(globalThis as any).Buffer = B;
(globalThis as any).__temajEnv = {
  APP_ENV: 'demo', SECRET_KEYS: `k1:${B.from(key).toString('base64')}`, SECRET_ACTIVE_KEY_ID: 'k1',
  LOGIN_IP_LIMIT: '1000', SESSION_TTL_MINUTES: '720',
};
export const Buffer = B;
