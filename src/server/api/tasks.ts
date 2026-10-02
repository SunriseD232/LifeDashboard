import { randomUUID } from 'node:crypto';
import { parseRule, RuleError, type Rule } from '@/lib/recur';
import { nextDue } from '@/lib/tasks';
import { householdOf } from '../household';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import { findTask } from '../taskStore';

function day(v: unknown, what = 'Дата'): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, `${what}: неверная дата.`);
  return v;
}

function rule(v: unknown): Rule | null {
  if (v === null || v === undefined) return null;
  try {
    const r = parseRule(v);
    if (r.kind === 'once') throw new HttpError(400, 'У дела «один раз» повтора нет — просто укажите дату.');
    return r;
  } catch (e) {
    if (e instanceof RuleError) throw new HttpError(400, e.message);
    throw e;
  }
}

/**
 * Дела: /api/tasks[/:id[/done|undo]].
 * Тело: { title, note, tag, due_date (null — срочно, без даты), rule (повтор,
 * у повторяющегося обязателен due_date — первый срок), shared (общее дело семьи) }.
 */
export function tasks({ d, userId, method, body, id, action }: Ctx): unknown {
  const sharedTo = (v: unknown): string | null => {
    if (!v) return null;
    const hh = householdOf(d, userId);
    if (!hh) throw new HttpError(400, 'Чтобы делиться делами, создайте семью в настройках.');
    return hh;
  };

  if (method === 'POST' && !id) {
    const r = rule(body.rule);
    const due = body.due_date === null || body.due_date === undefined ? null : day(body.due_date, 'Срок');
    if (r && !due) throw new HttpError(400, 'У повторяющегося дела нужен срок.');
    const tid = randomUUID();
    d.prepare(
      'insert into tasks (id, user_id, household_id, title, note, tag, due_date, rule) values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      tid,
      userId,
      sharedTo(body.shared),
      text(body.title, 200, 'Дело'),
      text(body.note, 2000, 'Заметка', true),
      text(body.tag, 30, 'Метка', true),
      due,
      r ? JSON.stringify(r) : null,
    );
    return { id: tid };
  }

  const t = findTask(d, userId, id);
  if (!t) throw new HttpError(404, 'Дело не найдено.');

  if (method === 'PATCH' && !action) {
    d.transaction(() => {
      const set = (col: string, v: unknown) => d.prepare(`update tasks set ${col} = ? where id = ?`).run(v, t.id);
      if (body.title !== undefined) set('title', text(body.title, 200, 'Дело'));
      if (body.note !== undefined) set('note', text(body.note, 2000, 'Заметка', true));
      if (body.tag !== undefined) set('tag', text(body.tag, 30, 'Метка', true));
      if (body.due_date !== undefined) set('due_date', body.due_date === null ? null : day(body.due_date, 'Срок'));
      if (body.rule !== undefined) {
        const r = rule(body.rule);
        set('rule', r ? JSON.stringify(r) : null);
      }
      // Сделать общим может любой, кто видит; сделать личным — только автор:
      // иначе общее дело пропало бы у остальных без их ведома.
      if (body.shared !== undefined) {
        if (!body.shared && t.household_id && t.user_id !== userId) throw new HttpError(403, 'Сделать личным может только автор.');
        set('household_id', sharedTo(body.shared));
      }
      const after = d.prepare('select rule, due_date from tasks where id = ?').get(t.id) as { rule: string | null; due_date: string | null };
      if (after.rule && !after.due_date) throw new HttpError(400, 'У повторяющегося дела нужен срок.');
    })();
    return { ok: true };
  }

  if (method === 'DELETE' && !action) {
    if (t.household_id && t.user_id !== userId) throw new HttpError(403, 'Удалить общее дело может только автор.');
    d.prepare('delete from tasks where id = ?').run(t.id);
    return { ok: true };
  }

  // Выполнить: обычное — закрывается, повторяющееся — переезжает на следующий
  // срок (а если повторы кончились — закрывается). day — местная дата устройства.
  if (method === 'POST' && action === 'done') {
    const today = day(body.day);
    if (t.done_at) return { ok: true };
    const next = t.rule ? nextDue(t.rule, t.due_date, today) : null;
    d.transaction(() => {
      d.prepare('insert into task_log (task_id, user_id, day, prev_due) values (?, ?, ?, ?)').run(t.id, userId, today, t.due_date);
      if (next) d.prepare('update tasks set due_date = ? where id = ?').run(next, t.id);
      else d.prepare('update tasks set done_at = ? where id = ?').run(today, t.id);
    })();
    return { ok: true, due_date: next, done_at: next ? null : today };
  }

  // Отменить сегодняшнюю отметку: вернуть срок и открыть дело.
  if (method === 'POST' && action === 'undo') {
    const today = day(body.day);
    const last = d
      .prepare('select rowid, prev_due from task_log where task_id = ? and day = ? order by rowid desc limit 1')
      .get(t.id, today) as { rowid: number; prev_due: string | null } | undefined;
    if (!last) return { ok: true };
    d.transaction(() => {
      d.prepare('delete from task_log where rowid = ?').run(last.rowid);
      d.prepare('update tasks set done_at = null, due_date = ? where id = ?').run(last.prev_due, t.id);
    })();
    return { ok: true };
  }

  return undefined;
}
