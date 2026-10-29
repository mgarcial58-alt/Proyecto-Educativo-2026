export const API = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export async function request(path, { token, ...options } = {}) {
  const headers = { ...options.headers };
  if (options.body || options.method === 'POST') headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, {
    ...options,
    headers,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || 'No se pudo completar la solicitud. Inténtalo de nuevo.');
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('Retry-After')) || 0;
    throw error;
  }
  return data;
}
