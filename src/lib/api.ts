import { supabase } from './supabase';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

async function getAuthHeader() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const authHeader = await getAuthHeader();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export type GenerationPayload = {
  title: string;
  prompt: string;
  stylePreset: string;
  outputType: 'image' | 'video';
};

export const api = {
  health: () => request<{ ok: boolean; service: string }>('/health'),
  createGeneration: (payload: GenerationPayload) =>
    request<{ jobId: string; status: string }>('/api/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listProjects: () => request<{ projects: Array<Record<string, unknown>> }>('/api/projects'),
  createCheckoutSession: (priceId: string) =>
    request<{ url: string }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ priceId }),
    }),
  subscribePush: (subscription: unknown) =>
    request<{ success: boolean }>('/api/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),
};
