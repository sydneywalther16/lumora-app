const API_BASE = import.meta.env.VITE_API_BASE_URL;

export async function createGeneration(prompt: string) {
  const res = await fetch(`${API_BASE}/api/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
    }),
  });

  if (!res.ok) {
    throw new Error('Failed to create generation');
  }

  return res.json();
}

export async function getGenerations() {
  const res = await fetch(`${API_BASE}/api/generations`);

  if (!res.ok) {
    throw new Error('Failed to fetch generations');
  }

  return res.json();
}
