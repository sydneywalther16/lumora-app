const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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

export type GenerationJob = {
  id: string;
  projectId: string | null;
  title: string;
  prompt: string;
  status: string;
  outputType: string;
  provider: string;
  resultAssetUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export const api = {
  health: () => request<{ ok: boolean; service: string }>('/health'),

  createGeneration: (payload: GenerationPayload) =>
    request<{ jobId: string; status: string }>('/api/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listGenerationJobs: () => request<{ jobs: GenerationJob[] }>('/api/generations'),

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
