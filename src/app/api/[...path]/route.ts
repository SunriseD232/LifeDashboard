import { NextResponse, type NextRequest } from 'next/server';
import { currentUserId, login, logout } from '@/lib/auth';
import { db } from '@/lib/db';
import { checklists } from '@/server/api/checklists';
import { items } from '@/server/api/items';
import { push } from '@/server/api/push';
import { reminders } from '@/server/api/reminders';
import { state } from '@/server/api/state';
import { HttpError, text, type Ctx } from '@/server/http';

/**
 * API LifeDashboard — одна точка входа на все маршруты /task/api/…: здесь
 * вход и выход, проверка сессии и разбор тела, а сами разделы — в
 * src/server/api/<раздел>.ts. Каждый запрос к базе там ограничен user_id —
 * чужие строки не найти даже по известному id.
 */

export const dynamic = 'force-dynamic';

const ROUTES: Record<string, (ctx: Ctx) => unknown | Promise<unknown>> = {
  state,
  checklists,
  items,
  reminders,
  push,
};

async function handle(req: NextRequest, path: string[]) {
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const [res, id, action] = path;

  // ---- вход и выход (src/lib/auth.ts) — до проверки сессии ----
  if (res === 'auth' && method === 'POST' && id === 'login') {
    const name = text(body.login, 64, 'Логин')!;
    if (typeof body.password !== 'string' || !body.password || body.password.length > 200) {
      throw new HttpError(400, 'Введите пароль.');
    }
    // IP клиента ставит nginx; без него (локальный запуск) — общий ключ.
    const ip = req.headers.get('x-real-ip') ?? 'local';
    const r = await login(name, body.password, ip);
    if (!r.ok) throw new HttpError(r.status, r.error);
    return { ok: true };
  }
  if (res === 'auth' && method === 'POST' && id === 'logout') {
    logout();
    return { ok: true };
  }

  const userId = await currentUserId();
  if (!userId) throw new HttpError(401, 'Войдите, чтобы открыть LifeDashboard.');

  const route = ROUTES[res];
  const result = route ? await route({ req, method, body, userId, d: db(), id, action }) : undefined;
  if (result === undefined) throw new HttpError(404, 'Нет такого действия.');
  return result;
}
async function route(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    return NextResponse.json(await handle(req, params.path ?? []));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[lifedashboard api]', e);
    return NextResponse.json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' }, { status: 500 });
  }
}

export { route as GET, route as POST, route as PATCH, route as PUT, route as DELETE };
