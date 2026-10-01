'use client';

/** Запрос к API «Сборов» (под basePath /task). Ошибка — с текстом от сервера. */
export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/task/api/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || 'Не удалось связаться с сервером.') as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return data as T;
}
