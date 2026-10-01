import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Кто пришёл — по сессии MediaWatch.
 *
 * Вход у «Сборов» общий с MediaWatch: тот же домен, и кука сессии Supabase
 * приходит сюда сама. Сервер проверяет её у Supabase Auth (getUser — сетевой
 * запрос, а не чтение куки на веру) и дальше работает только со своей базой
 * (src/lib/db.ts): из Supabase мы берём лишь id пользователя.
 *
 * Имя куки закреплено так же, как в AnimeWatch/src/lib/supabase/client.ts —
 * без него @supabase/ssr вывел бы его из хоста и не увидел бы сессию.
 *
 * Ответ кэшируется на минуту по токену: интерфейс делает несколько запросов
 * подряд, и гонять каждый к Auth незачем.
 */
const AUTH_COOKIE_NAME = 'sb-ubqmltwcfbquenvcxbyl-auth-token';
const CACHE_MS = 60_000;

const cache = new Map<string, { id: string; until: number }>();

export async function currentUserId(): Promise<string | null> {
  // Только для локальной разработки (next dev): проверить интерфейс без
  // боевого Supabase. В сборке для сервера NODE_ENV === 'production', и эта
  // ветка не срабатывает, что бы ни лежало в окружении.
  if (process.env.NODE_ENV === 'development' && process.env.SBORY_DEV_USER) {
    return process.env.SBORY_DEV_USER;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY не заданы');

  const store = cookies();
  const raw = store
    .getAll()
    .filter((c) => c.name.startsWith(AUTH_COOKIE_NAME))
    .map((c) => `${c.name}=${c.value}`)
    .join(';');
  if (!raw) return null;

  const now = Date.now();
  const hit = cache.get(raw);
  if (hit && hit.until > now) return hit.id;

  const client = createServerClient(url, key, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll: () => store.getAll(),
      // Обновлённые токены отдаём браузеру — иначе сессия «Сборов» тихо
      // истекала бы, пока MediaWatch не обновит её сам.
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* вызвано не из обработчика запроса — ставить некуда, и не нужно */
        }
      },
    },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  if (cache.size > 500) cache.clear();
  cache.set(raw, { id: data.user.id, until: now + CACHE_MS });
  return data.user.id;
}
