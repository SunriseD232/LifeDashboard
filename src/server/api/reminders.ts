import { randomUUID } from 'node:crypto';
import { parseRule, RuleError, type Rule } from '@/lib/recur';
import { findChecklist } from '../checklistStore';
import { DAY_RE, HttpError, own, text, type Ctx } from '../http';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES = 8;
export const NAG_OPTIONS = [15, 30, 60];

function nag(v: unknown): number | null {
  if (v === null || v === undefined || v === 0) return null;
  if (typeof v !== 'number' || !NAG_OPTIONS.includes(v)) throw new HttpError(400, 'Повтор — через 15, 30 или 60 минут.');
  return v;
}

function times(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, 'Укажите время.');
  const out = [...new Set(v.map((t) => (typeof t === 'string' ? t.slice(0, 5) : '')))].sort();
  if (out.some((t) => !TIME_RE.test(t))) throw new HttpError(400, 'Неверное время.');
  if (out.length > MAX_TIMES) throw new HttpError(400, `Не больше ${MAX_TIMES} раз в день.`);
  return out;
}

function rule(v: unknown): Rule {
  try {
    return parseRule(v);
  } catch (e) {
    if (e instanceof RuleError) throw new HttpError(400, e.message);
    throw e;
  }
}

/**
 * Напоминания: /api/reminders[/:id[/done|snooze]].
 * Тело: { title, times: ['09:00', …], rule (src/lib/recur.ts), checklist_id, nag, tag }.
 */
export function reminders({ d, userId, method, body, id, action }: Ctx): unknown {
  const checklistId = (v: unknown) => {
    const cid = typeof v === 'string' ? v : null;
    return cid && findChecklist(d, userId, cid) ? cid : null;
  };
  // «После выполнения» считается от отметки — второе время в сутках там
  // путало бы отсчёт.
  const checkPair = (t: string[], r: Rule) => {
    if (r.kind === 'after' && t.length > 1) throw new HttpError(400, 'У повтора «после выполнения» — одно время.');
  };

  if (method === 'POST' && !id) {
    const t = times(body.times);
    const r = rule(body.rule);
    checkPair(t, r);
    const rid = randomUUID();
    d.prepare('insert into reminders (id, user_id, title, times, rule, checklist_id, nag, tag) values (?, ?, ?, ?, ?, ?, ?, ?)').run(
      rid,
      userId,
      text(body.title, 120, 'Что сделать'),
      JSON.stringify(t),
      JSON.stringify(r),
      checklistId(body.checklist_id),
      nag(body.nag),
      text(body.tag, 30, 'Метка', true),
    );
    return { id: rid };
  }

  const cur = own(
    d.prepare('select id, times, rule from reminders where id = ? and user_id = ?').get(id, userId) as
      | { id: string; times: string; rule: string }
      | undefined,
    'Напоминание',
  );
  const curTimes = JSON.parse(cur.times) as string[];
  const slotOf = (v: unknown) => {
    const s = typeof v === 'string' ? v : curTimes[0];
    if (!curTimes.includes(s)) throw new HttpError(400, 'У напоминания нет такого времени.');
    return s;
  };
  const dayOf = (v: unknown) => {
    if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, 'Неверная дата.');
    return v;
  };

  if (method === 'PATCH' && !action) {
    const t = body.times !== undefined ? times(body.times) : curTimes;
    const r = body.rule !== undefined ? rule(body.rule) : (JSON.parse(cur.rule) as Rule);
    checkPair(t, r);
    d.transaction(() => {
      if (body.title !== undefined) d.prepare('update reminders set title = ? where id = ?').run(text(body.title, 120, 'Что сделать'), id);
      if (body.nag !== undefined) d.prepare('update reminders set nag = ? where id = ?').run(nag(body.nag), id);
      if (body.tag !== undefined) d.prepare('update reminders set tag = ? where id = ?').run(text(body.tag, 30, 'Метка', true), id);
      if (body.checklist_id !== undefined) d.prepare('update reminders set checklist_id = ? where id = ?').run(checklistId(body.checklist_id), id);
      d.prepare('update reminders set times = ?, rule = ? where id = ?').run(JSON.stringify(t), JSON.stringify(r), id);
      // Убранное время — его отметки и отложенные больше не нужны.
      const keep = JSON.stringify(t);
      d.prepare('delete from reminder_snooze where reminder_id = ? and slot not in (select value from json_each(?))').run(id, keep);
    })();
    return { ok: true };
  }
  if (method === 'DELETE' && !action) {
    d.prepare('delete from reminders where id = ?').run(id);
    return { ok: true };
  }
  if (method === 'PUT' && action === 'done') {
    const day = dayOf(body.day);
    const slot = slotOf(body.slot);
    d.transaction(() => {
      if (body.done) {
        d.prepare('insert or ignore into reminder_done (reminder_id, user_id, day, slot) values (?, ?, ?, ?)').run(id, userId, day, slot);
        d.prepare('delete from reminder_snooze where reminder_id = ? and day = ? and slot = ?').run(id, day, slot);
      } else {
        d.prepare('delete from reminder_done where reminder_id = ? and day = ? and slot = ?').run(id, day, slot);
      }
    })();
    return { ok: true };
  }
  if (method === 'POST' && action === 'snooze') {
    // Время «отложить до» считает устройство — оно знает местное время.
    const day = dayOf(body.day);
    const slot = slotOf(body.slot);
    if (body.at === null) {
      d.prepare('delete from reminder_snooze where reminder_id = ? and day = ? and slot = ?').run(id, day, slot);
      return { ok: true };
    }
    if (typeof body.at !== 'string' || !TIME_RE.test(body.at)) throw new HttpError(400, 'Неверное время.');
    d.prepare(
      `insert into reminder_snooze (reminder_id, user_id, day, slot, at) values (?, ?, ?, ?, ?)
       on conflict (reminder_id, day, slot) do update set at = excluded.at`,
    ).run(id, userId, day, slot, body.at);
    return { ok: true };
  }
  return undefined;
}
