import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendToUser, vapidPublicKey } from '@/lib/push';
import type { Checklist, ChecklistItem, Reminder, Repeat } from '@/lib/types';

/**
 * API «Сборов» — один обработчик на все маршруты /task/api/…: их немного, и
 * общая проверка входа и разбор тела в одном месте надёжнее, чем десяток
 * файлов с копиями. Каждый запрос к базе ограничен user_id — чужие строки не
 * найти даже по известному id.
 */

export const dynamic = 'force-dynamic';

const ICONS = new Set(['bag', 'wave', 'house', 'list']);
const REPEATS = new Set<Repeat>(['once', 'daily', 'weekdays']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
/** Push-сервисы браузеров: Chrome/Яндекс/Edge (FCM), Safari (Apple),
 *  Firefox (Mozilla), старый Edge (Windows). */
const PUSH_HOSTS =
  /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function text(v: unknown, max: number, field: string, optional = false): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (optional) return null;
    throw new HttpError(400, `Заполните поле «${field}».`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `Поле «${field}» должно быть текстом.`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `«${field}» — не длиннее ${max} символов.`);
  return t;
}

function itemRow(r: Record<string, unknown>): ChecklistItem {
  return { ...(r as unknown as ChecklistItem), done: !!r.done };
}

function own<T>(row: T | undefined, what: string): T {
  if (!row) throw new HttpError(404, `${what} не найден.`);
  return row;
}

async function handle(req: NextRequest, path: string[]) {
  const userId = await currentUserId();
  if (!userId) throw new HttpError(401, 'Войдите в MediaWatch, чтобы открыть «Сборы».');
  const d = db();
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const [res, id, action] = path;

  // ---- всё сразу: экран открывается одним запросом ----
  if (method === 'GET' && res === 'state') {
    const day = req.nextUrl.searchParams.get('day') ?? '';
    if (!DAY_RE.test(day)) throw new HttpError(400, 'Неверная дата.');
    const checklists = d
      .prepare('select id, title, icon, position from checklists where user_id = ? order by position, created_at')
      .all(userId) as Checklist[];
    const items = (
      d
        .prepare(
          'select id, checklist_id, title, group_name, note, done, position from checklist_items where user_id = ? order by position, created_at',
        )
        .all(userId) as Record<string, unknown>[]
    ).map(itemRow);
    const reminders = d
      .prepare(
        'select id, title, at_time, repeat, on_date, checklist_id from reminders where user_id = ? order by at_time, created_at',
      )
      .all(userId) as Reminder[];
    const done = (
      d.prepare('select reminder_id from reminder_done where user_id = ? and day = ?').all(userId, day) as {
        reminder_id: string;
      }[]
    ).map((r) => r.reminder_id);
    return { checklists, items, reminders, done };
  }

  // ---- чек-листы ----
  if (res === 'checklists') {
    if (method === 'POST' && !id) {
      const title = text(body.title, 80, 'Название')!;
      const icon = ICONS.has(body.icon) ? body.icon : 'bag';
      const cid = randomUUID();
      const pos =
        ((d.prepare('select max(position) as m from checklists where user_id = ?').get(userId) as { m: number | null })
          .m ?? -1) + 1;
      const insertItem = d.prepare(
        'insert into checklist_items (id, checklist_id, user_id, title, group_name, position) values (?, ?, ?, ?, ?, ?)',
      );
      d.transaction(() => {
        d.prepare('insert into checklists (id, user_id, title, icon, position) values (?, ?, ?, ?, ?)').run(
          cid,
          userId,
          title,
          icon,
          pos,
        );
        const seed: unknown[] = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
        seed.forEach((raw, i) => {
          const it = raw as { title?: unknown; group_name?: unknown };
          insertItem.run(randomUUID(), cid, userId, text(it.title, 120, 'Вещь')!, text(it.group_name, 60, 'Группа', true), i);
        });
      })();
      return { id: cid };
    }

    const list = own(
      d.prepare('select id from checklists where id = ? and user_id = ?').get(id, userId) as { id: string } | undefined,
      'Чек-лист',
    );

    if (method === 'PATCH' && !action) {
      if (body.title !== undefined) {
        d.prepare('update checklists set title = ? where id = ?').run(text(body.title, 80, 'Название'), list.id);
      }
      if (body.icon !== undefined && ICONS.has(body.icon)) {
        d.prepare('update checklists set icon = ? where id = ?').run(body.icon, list.id);
      }
      return { ok: true };
    }
    if (method === 'DELETE' && !action) {
      d.prepare('delete from checklists where id = ?').run(list.id);
      return { ok: true };
    }
    if (method === 'POST' && action === 'reset') {
      d.prepare('update checklist_items set done = 0 where checklist_id = ?').run(list.id);
      return { ok: true };
    }
    if (method === 'POST' && action === 'items') {
      const iid = randomUUID();
      const pos =
        ((d.prepare('select max(position) as m from checklist_items where checklist_id = ?').get(list.id) as {
          m: number | null;
        }).m ?? -1) + 1;
      d.prepare(
        'insert into checklist_items (id, checklist_id, user_id, title, group_name, position) values (?, ?, ?, ?, ?, ?)',
      ).run(iid, list.id, userId, text(body.title, 120, 'Вещь'), text(body.group_name, 60, 'Группа', true), pos);
      return { id: iid, position: pos };
    }
    if (method === 'POST' && action === 'reorder') {
      const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [];
      const upd = d.prepare('update checklist_items set position = ? where id = ? and checklist_id = ?');
      d.transaction(() => ids.forEach((iid, i) => upd.run(i, String(iid), list.id)))();
      return { ok: true };
    }
    if (method === 'POST' && action === 'rename-group') {
      const to = text(body.to, 60, 'Группа', true);
      const from = body.from === null ? null : text(body.from, 60, 'Группа');
      if (from === null) {
        d.prepare('update checklist_items set group_name = ? where checklist_id = ? and group_name is null').run(to, list.id);
      } else {
        d.prepare('update checklist_items set group_name = ? where checklist_id = ? and group_name = ?').run(
          to,
          list.id,
          from,
        );
      }
      return { ok: true };
    }
    if (method === 'POST' && action === 'delete-group') {
      const from = body.from === null ? null : text(body.from, 60, 'Группа');
      if (from === null) d.prepare('delete from checklist_items where checklist_id = ? and group_name is null').run(list.id);
      else d.prepare('delete from checklist_items where checklist_id = ? and group_name = ?').run(list.id, from);
      return { ok: true };
    }
  }

  // ---- пункты чек-листа ----
  if (res === 'items' && id) {
    own(d.prepare('select id from checklist_items where id = ? and user_id = ?').get(id, userId), 'Пункт');
    if (method === 'PATCH') {
      if (body.title !== undefined) d.prepare('update checklist_items set title = ? where id = ?').run(text(body.title, 120, 'Вещь'), id);
      if (body.done !== undefined) d.prepare('update checklist_items set done = ? where id = ?').run(body.done ? 1 : 0, id);
      if (body.note !== undefined) d.prepare('update checklist_items set note = ? where id = ?').run(text(body.note, 120, 'Заметка', true), id);
      if (body.group_name !== undefined) {
        d.prepare('update checklist_items set group_name = ? where id = ?').run(text(body.group_name, 60, 'Группа', true), id);
      }
      return { ok: true };
    }
    if (method === 'DELETE') {
      d.prepare('delete from checklist_items where id = ?').run(id);
      return { ok: true };
    }
  }

  // ---- напоминания ----
  if (res === 'reminders') {
    const readFields = (partial: boolean) => {
      const out: Partial<Reminder> = {};
      if (!partial || body.title !== undefined) out.title = text(body.title, 120, 'Что сделать')!;
      if (!partial || body.at_time !== undefined) {
        if (typeof body.at_time !== 'string' || !TIME_RE.test(body.at_time)) throw new HttpError(400, 'Укажите время.');
        out.at_time = body.at_time.slice(0, 5);
      }
      if (!partial || body.repeat !== undefined) {
        if (!REPEATS.has(body.repeat)) throw new HttpError(400, 'Неизвестный повтор.');
        out.repeat = body.repeat;
      }
      if (!partial || body.on_date !== undefined) {
        out.on_date = typeof body.on_date === 'string' && DAY_RE.test(body.on_date) ? body.on_date : null;
      }
      if (!partial || body.checklist_id !== undefined) {
        const cid = typeof body.checklist_id === 'string' ? body.checklist_id : null;
        out.checklist_id =
          cid && d.prepare('select 1 from checklists where id = ? and user_id = ?').get(cid, userId) ? cid : null;
      }
      return out;
    };

    if (method === 'POST' && !id) {
      const f = readFields(false);
      if (f.repeat === 'once' && !f.on_date) throw new HttpError(400, 'Для разового напоминания нужна дата.');
      const rid = randomUUID();
      d.prepare(
        'insert into reminders (id, user_id, title, at_time, repeat, on_date, checklist_id) values (?, ?, ?, ?, ?, ?, ?)',
      ).run(rid, userId, f.title, f.at_time, f.repeat, f.repeat === 'once' ? f.on_date : null, f.checklist_id);
      return { id: rid };
    }

    own(d.prepare('select id from reminders where id = ? and user_id = ?').get(id, userId), 'Напоминание');

    if (method === 'PATCH' && !action) {
      const f = readFields(true);
      for (const [k, v] of Object.entries(f)) {
        d.prepare(`update reminders set ${k} = ? where id = ?`).run(v, id);
      }
      return { ok: true };
    }
    if (method === 'DELETE' && !action) {
      d.prepare('delete from reminders where id = ?').run(id);
      return { ok: true };
    }
    if (method === 'PUT' && action === 'done') {
      if (typeof body.day !== 'string' || !DAY_RE.test(body.day)) throw new HttpError(400, 'Неверная дата.');
      if (body.done) {
        d.prepare('insert or ignore into reminder_done (reminder_id, user_id, day) values (?, ?, ?)').run(id, userId, body.day);
      } else {
        d.prepare('delete from reminder_done where reminder_id = ? and day = ?').run(id, body.day);
      }
      return { ok: true };
    }
  }

  // ---- push-уведомления (src/lib/push.ts) ----
  if (res === 'push') {
    if (method === 'GET' && id === 'key') {
      return { key: vapidPublicKey() };
    }
    if (method === 'POST' && id === 'subscribe') {
      const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
      const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
      const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
      const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
      // Только настоящие push-сервисы браузеров: на этот адрес потом ходит
      // наш сервер, и произвольный URL превратил бы рассылку в способ слать
      // запросы куда угодно от имени сервера.
      let host = '';
      try {
        const u = new URL(endpoint);
        host = u.protocol === 'https:' ? u.hostname : '';
      } catch {
        host = '';
      }
      if (!PUSH_HOSTS.test(host) || endpoint.length > 1000 || !p256dh || !auth) {
        throw new HttpError(400, 'Неверная подписка.');
      }
      let tz = typeof body.tz === 'string' && body.tz.length < 64 ? body.tz : 'Europe/Moscow';
      try {
        new Intl.DateTimeFormat('ru', { timeZone: tz });
      } catch {
        tz = 'Europe/Moscow';
      }
      d.prepare(
        `insert into push_subscriptions (endpoint, user_id, p256dh, auth, tz, updated_at)
         values (?, ?, ?, ?, ?, datetime('now'))
         on conflict(endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
           auth = excluded.auth, tz = excluded.tz, updated_at = excluded.updated_at`,
      ).run(endpoint, userId, p256dh, auth, tz);
      return { ok: true };
    }
    if (method === 'POST' && id === 'unsubscribe') {
      if (typeof body.endpoint === 'string') {
        d.prepare('delete from push_subscriptions where endpoint = ? and user_id = ?').run(body.endpoint, userId);
      }
      return { ok: true };
    }
    if (method === 'POST' && id === 'test') {
      const delivered = await sendToUser(userId, {
        title: 'Сборы',
        body: 'Уведомления работают — напомним о делах вовремя.',
        tag: 'test',
        url: '/task#reminders',
      });
      if (!delivered) throw new HttpError(409, 'Не удалось отправить: включите уведомления на этом устройстве ещё раз.');
      return { delivered };
    }
  }

  throw new HttpError(404, 'Нет такого действия.');
}

async function route(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    return NextResponse.json(await handle(req, params.path ?? []));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[sbory api]', e);
    return NextResponse.json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' }, { status: 500 });
  }
}

export { route as GET, route as POST, route as PATCH, route as PUT, route as DELETE };
