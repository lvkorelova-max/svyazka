const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

let accessToken = null;
let refreshPromise = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const nested = data?.message?.message;
    const message = Array.isArray(nested)
      ? nested.join(', ')
      : nested || data?.message || 'Не удалось выполнить запрос';
    throw new Error(typeof message === 'string' ? message : 'Не удалось выполнить запрос');
  }
  return data;
}

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetchWithTimeout(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(parseResponse)
      .then((data) => {
        accessToken = data.accessToken;
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function api(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetchWithTimeout(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    await refreshSession();
    return api(path, options, false);
  }
  return parseResponse(response);
}

export async function restoreSession() {
  try {
    const refreshed = await refreshSession();
    return api('/auth/me');
  } catch {
    accessToken = null;
    return null;
  }
}
