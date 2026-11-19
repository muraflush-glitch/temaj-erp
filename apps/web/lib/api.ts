'use client';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const KEY = 'temaj_erp_token';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

// Token-i mbahet vetëm për sesionin e skedës (sessionStorage), jo përgjithmonë.
export const tokenStore = {
  get: (): string | null => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string): void => { try { sessionStorage.setItem(KEY, t); } catch { /* bosh */ } },
  clear: (): void => { try { sessionStorage.removeItem(KEY); } catch { /* bosh */ } },
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401 && data.code === 'UNAUTHENTICATED') tokenStore.clear();
    throw new ApiError(res.status, data.code ?? 'HTTP', data.message ?? 'Gabim i panjohur');
  }
  return data as T;
}

export interface Me {
  id: number; email: string; displayName: string; mfaEnabled: boolean; mfaPassed: boolean;
  permissions: { permission: string; branch_id: number | null }[];
}
export interface Branch { id: string; code: string; name: string; city: string; legal_entity_name: string; legal_entity_verified: boolean }
export interface ApprovalRequest {
  id: string; action_code: string; branch_id: string | null; amount: string; payload: Record<string, unknown>;
  reason: string; status: string; requested_by: string; created_at: string;
}
