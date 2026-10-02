'use client';

import { enqueue, queueable } from './offline';

/** Нет сети (или сервер недоступен) — для понятного текста и офлайна. */
export class OfflineError extends Error {
  offline = true;
  constructor() {
    super('Нет сети. Попробуйте, когда появится интернет.');
  }
}

/**
 * Запрос к API LifeDashboard (под basePath /task). Ошибка — с текстом от сервера.
 *
 * Без сети изменения своих данных (src/lib/offline.ts) не падают, а встают в
 * очередь: ответ — { queued: true, id: временный id }, экран уже обновлён
 * оптимистично и ждёт отправки.
 */
export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  // Правка того, что создано без сети и ещё не отправлено, — тоже в очередь,
  // следом за созданием (там подставится настоящий id).
  if (path.includes('tmp-') && queueable(path, method)) {
    const q = enqueue(path, method, body);
    return { queued: true, id: q.tempId } as T;
  }
  let res: Response;
  try {
    res = await send(path, method, body);
  } catch (e) {
    if (e instanceof OfflineError && queueable(path, method)) {
      const q = enqueue(path, method, body);
      return { queued: true, id: q.tempId, position: Date.now() } as T;
    }
    throw e;
  }
  return parse<T>(res);
}

/** Сам запрос без очереди — его же зовёт отправка очереди. */
export async function apiDirect<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return parse<T>(await send(path, method, body));
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`/task/api/${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new OfflineError();
  }
}

async function parse<T>(res: Response): Promise<T> {
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
