import { NextResponse, type NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { ai } from '@/server/api/ai';
import { auth } from '@/server/api/auth';
import { checklists } from '@/server/api/checklists';
import { household } from '@/server/api/household';
import { notes } from '@/server/api/notes';
import { items } from '@/server/api/items';
import { kitchen } from '@/server/api/kitchen';
import { push } from '@/server/api/push';
import { reminders } from '@/server/api/reminders';
import { search } from '@/server/api/search';
import { support } from '@/server/api/support';
import { settings } from '@/server/api/settings';
import { state } from '@/server/api/state';
import { tasks } from '@/server/api/tasks';
import { weather } from '@/server/api/weather';
import { workoutExercises, workouts, workoutSets, workoutTemplates } from '@/server/api/workouts';
import { calendarFeed } from '@/server/calendar';
import { HttpError, type Ctx } from '@/server/http';

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
  tasks,
  household,
  settings,
  weather,
  notes,
  search,
  kitchen,
  ai,
  support,
  workouts,
  'workout-exercises': workoutExercises,
  'workout-sets': workoutSets,
  'workout-templates': workoutTemplates,
};

async function handle(req: NextRequest, path: string[]) {
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const [res, id, action] = path;

  // ---- вход, регистрация, сброс пароля — до проверки сессии ----
  if (res === 'auth') {
    const r = await auth(db(), req, body, id, action);
    if (r === undefined) throw new HttpError(404, 'Нет такого действия.');
    return r;
  }

  const userId = await currentUserId();
  if (!userId) throw new HttpError(401, 'Войдите, чтобы открыть LifeDashboard.');

  const route = ROUTES[res];
  const result = route ? await route({ req, method, body, userId, d: db(), id, action }) : undefined;
  if (result === undefined) throw new HttpError(404, 'Нет такого действия.');
  return result;
}
async function route(req: NextRequest, { params }: { params: { path: string[] } }) {
  // Календарь по подписке — без входа, по секрету в ссылке (src/server/calendar.ts).
  const [res, file] = params.path ?? [];
  if (res === 'calendar' && req.method === 'GET' && file) {
    const ics = calendarFeed(db(), file.replace(/\.ics$/, ''));
    if (!ics) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(ics, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="lifedashboard.ics"', 'Cache-Control': 'private, max-age=300' },
    });
  }
  try {
    return NextResponse.json(await handle(req, params.path ?? []));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[lifedashboard api]', e);
    return NextResponse.json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' }, { status: 500 });
  }
}

export { route as GET, route as POST, route as PATCH, route as PUT, route as DELETE };
