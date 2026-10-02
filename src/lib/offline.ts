'use client';

/**
 * Работа без интернета.
 *
 * 1. Последние данные (ответ /api/state) лежат на устройстве — без сети
 *    приложение открывается с ними и честно пишет «Нет сети».
 * 2. Изменения (галочки, новые дела, покупки, правки заметок) без сети не
 *    теряются: копятся в очереди и уходят на сервер по порядку, когда сеть
 *    вернётся. Если тот же пункт тем временем изменили с другого устройства —
 *    побеждает то, что пришло на сервер последним.
 * 3. Новое, созданное без сети, получает временный id «tmp-…»; когда сервер
 *    выдаст настоящий, он подставляется в следующие запросы очереди.
 *
 * Хранилище — localStorage (данных немного); при выходе из аккаунта всё
 * стирается. ИИ, поиск и погода без сети не работают — для них очереди нет.
 */

export interface Queued {
  id: string;
  path: string;
  method: string;
  body?: unknown;
  /** Временный id того, что этот запрос создаёт (POST без id). */
  tempId?: string;
  at: number;
}

const OUTBOX = 'ld:outbox';
const STATE = 'ld:state';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* место кончилось или хранилище закрыто — без офлайна, но работаем */
  }
}

/** Что можно отложить до появления сети: отметки и правки своих данных. */
const QUEUEABLE = [
  /^tasks$/,
  /^tasks\/[^/]+(\/(done|undo))?$/,
  /^reminders$/,
  /^reminders\/[^/]+(\/(done|snooze))?$/,
  /^items\/[^/]+$/,
  /^checklists\/[^/]+\/items$/,
  /^kitchen\/shopping(\/clear)?$/,
  /^kitchen\/pantry(\/[^/]+)?$/,
  /^notes\/[^/]+$/,
];

export function queueable(path: string, method: string): boolean {
  return method !== 'GET' && QUEUEABLE.some((re) => re.test(path.split('?')[0]));
}

export const isTemp = (id: string) => id.startsWith('tmp-');

const listeners = new Set<() => void>();
export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

export function outbox(): Queued[] {
  return read<Queued[]>(OUTBOX, []);
}

export function enqueue(path: string, method: string, body?: unknown): Queued {
  const creates = method === 'POST' && (path === 'tasks' || path === 'reminders' || /^checklists\/[^/]+\/items$/.test(path));
  const q: Queued = { id: Math.random().toString(36).slice(2), path, method, body, at: Date.now(), ...(creates ? { tempId: `tmp-${Math.random().toString(36).slice(2, 10)}` } : {}) };
  write(OUTBOX, [...outbox(), q]);
  changed();
  window.dispatchEvent(new CustomEvent('ld:queued', { detail: q }));
  return q;
}

/**
 * Отправить очередь по порядку. send — обычный запрос к API. Нет сети —
 * останавливаемся (попробуем позже); сервер отказал (4xx) — запрос выкидываем:
 * повторять его бессмысленно. Возвращает, сколько отправлено и отклонено.
 */
export async function flush(send: (path: string, method: string, body?: unknown) => Promise<unknown>): Promise<{ sent: number; rejected: number }> {
  let sent = 0;
  let rejected = 0;
  const ids = new Map<string, string>();
  for (;;) {
    const [q] = outbox();
    if (!q) break;
    // Подставить настоящие id вместо временных из уже отправленного.
    let path = q.path;
    for (const [tmp, real] of ids) path = path.split(tmp).join(real);
    if (path.includes('tmp-')) {
      // Создание не прошло — и этот запрос не к чему применить.
      drop(q.id);
      rejected++;
      continue;
    }
    try {
      const res = (await send(path, q.method, q.body)) as { id?: string } | undefined;
      if (q.tempId && res?.id) ids.set(q.tempId, res.id);
      drop(q.id);
      sent++;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 401) {
        drop(q.id);
        rejected++;
        continue;
      }
      break;
    }
  }
  return { sent, rejected };
}

function drop(id: string): void {
  write(
    OUTBOX,
    outbox().filter((q) => q.id !== id),
  );
  changed();
}

/** Копия последних данных — чтобы открыться без сети. */
export function saveState(login: string | null | undefined, state: unknown): void {
  write(STATE, { login: login ?? null, state, at: Date.now() });
}
export function loadState<T>(): { state: T; at: number } | null {
  return read<{ state: T; at: number } | null>(STATE, null);
}

/** Выход из аккаунта — на устройстве не остаётся ни данных, ни очереди. */
export function clearOffline(): void {
  try {
    localStorage.removeItem(STATE);
    localStorage.removeItem(OUTBOX);
  } catch {
    /* нечего стирать */
  }
  changed();
}
