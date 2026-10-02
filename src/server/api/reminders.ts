import { randomUUID } from 'node:crypto';
import type { Reminder, Repeat } from '@/lib/types';
import { DAY_RE, HttpError, own, text, type Ctx } from '../http';

const REPEATS = new Set<Repeat>(['once', 'daily', 'weekdays']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Напоминания: /api/reminders[/:id[/done]]. */
export function reminders({ d, userId, method, body, id, action }: Ctx): unknown {
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
  return undefined;
}
