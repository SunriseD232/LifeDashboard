import { randomUUID } from 'node:crypto';
import { parseRule, RuleError, type Rule } from '@/lib/recur';
import { findChecklist } from '../checklistStore';
import { loginOf, notifyFamily, notifyUser } from '../familyEvents';
import { assigneeOf, householdOf } from '../household';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import { findReminder } from '../reminderStore';
import { priority, tagsFor } from '../tagStore';

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
 * Тело: { title, times: ['09:00', …], rule (src/lib/recur.ts), checklist_id, nag, tags: [...], priority: 0–3, note,
 * shared (общее для семьи), assignee (логин — кто делает и кому push; пусто — всем) }.
 * Общее: менять и отмечать могут все в семье (отметил один — сделано у всех),
 * удалить или сделать личным — только автор. «Отложить» у каждого своё.
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

  const sharedTo = (v: unknown): string | null => {
    if (!v) return null;
    const hh = householdOf(d, userId);
    if (!hh) throw new HttpError(400, 'Чтобы делиться, создайте семью в настройках.');
    return hh;
  };
  const tellAssignee = (who: string | null, title: string) => {
    if (who && who !== userId) notifyUser(d, who, 'assign', `${title} — от ${loginOf(d, userId)}`, '/task/tasks');
  };

  if (method === 'POST' && !id) {
    const t = times(body.times);
    const r = rule(body.rule);
    checkPair(t, r);
    const rid = randomUUID();
    const hh = sharedTo(body.shared);
    const who = assigneeOf(d, hh, body.assignee);
    const title = text(body.title, 120, 'Что сделать')!;
    d.prepare(
      'insert into reminders (id, user_id, title, times, rule, checklist_id, nag, tags, priority, note, household_id, assignee_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      rid,
      userId,
      title,
      JSON.stringify(t),
      JSON.stringify(r),
      checklistId(body.checklist_id),
      nag(body.nag),
      tagsFor(d, userId, body.tags),
      priority(body.priority),
      text(body.note, 2000, 'Заметка', true),
      hh,
      who,
    );
    tellAssignee(who, title);
    return { id: rid };
  }

  const cur = findReminder(d, userId, id);
  if (!cur) throw new HttpError(404, 'Напоминание не найдено.');
  const authored = cur.user_id === userId;
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
      if (body.tags !== undefined) d.prepare('update reminders set tags = ? where id = ?').run(tagsFor(d, userId, body.tags), id);
      if (body.priority !== undefined) d.prepare('update reminders set priority = ? where id = ?').run(priority(body.priority), id);
      if (body.note !== undefined) d.prepare('update reminders set note = ? where id = ?').run(text(body.note, 2000, 'Заметка', true), id);
      if (body.checklist_id !== undefined) d.prepare('update reminders set checklist_id = ? where id = ?').run(checklistId(body.checklist_id), id);
      d.prepare('update reminders set times = ?, rule = ? where id = ?').run(JSON.stringify(t), JSON.stringify(r), id);
      // Сделать общим может любой, кто видит; личным — только автор.
      let hh = cur.household_id;
      if (body.shared !== undefined) {
        if (!body.shared && cur.household_id && !authored) throw new HttpError(403, 'Сделать личным может только автор.');
        hh = sharedTo(body.shared);
        d.prepare('update reminders set household_id = ? where id = ?').run(hh, id);
        if (!hh) d.prepare('update reminders set assignee_id = null where id = ?').run(id);
      }
      if (body.assignee !== undefined) {
        const who = assigneeOf(d, hh, body.assignee);
        d.prepare('update reminders set assignee_id = ? where id = ?').run(who, id);
        if (who !== cur.assignee_id) tellAssignee(who, body.title !== undefined ? String(body.title).trim() : cur.title);
      }
      // Убранное время — его отметки и отложенные больше не нужны.
      const keep = JSON.stringify(t);
      d.prepare('delete from reminder_snooze where reminder_id = ? and slot not in (select value from json_each(?))').run(id, keep);
    })();
    return { ok: true };
  }
  if (method === 'DELETE' && !action) {
    if (cur.household_id && !authored) throw new HttpError(403, 'Удалить общее напоминание может только автор.');
    d.prepare('delete from reminders where id = ?').run(id);
    return { ok: true };
  }
  if (method === 'PUT' && action === 'done') {
    const day = dayOf(body.day);
    const slot = slotOf(body.slot);
    d.transaction(() => {
      if (body.done) {
        const fresh = d.prepare('insert or ignore into reminder_done (reminder_id, user_id, day, slot) values (?, ?, ?, ?)').run(id, userId, day, slot).changes;
        d.prepare('delete from reminder_snooze where reminder_id = ? and day = ? and slot = ?').run(id, day, slot);
        if (fresh && cur.household_id) notifyFamily(d, userId, 'done', `${cur.title} (${loginOf(d, userId)})`, '/task/tasks', cur.household_id);
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
