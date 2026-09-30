export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/docs${path}`, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data as T;
}
