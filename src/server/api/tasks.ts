import { randomUUID } from 'node:crypto';
import { findChecklist } from '../checklistStore';
import { loginOf, notifyFamily, notifyUser } from '../familyEvents';
import { assigneeOf, householdOf } from '../household';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import { priority, tagsFor } from '../tagStore';
import { findTask } from '../taskStore';

function day(v: unknown): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, 'Неверная дата.');
  return v;
}

/**
 * Задачи без напоминания: /api/tasks[/:id[/done|undo]].
 * Тело: { title, note, tags: [...], priority: 0–3, checklist_id, shared (общая задача семьи),
 * assignee (логин из семьи — кто делает; пусто — все) }.
 */
export function tasks({ d, userId, method, body, id, action }: Ctx): unknown {
  const sharedTo = (v: unknown): string | null => {
    if (!v) return null;
    const hh = householdOf(d, userId);
    if (!hh) throw new HttpError(400, 'Чтобы делиться задачами, создайте семью в настройках.');
    return hh;
  };
  const checklistId = (v: unknown) => {
    const cid = typeof v === 'string' ? v : null;
    return cid && findChecklist(d, userId, cid) ? cid : null;
  };

  // Поручили не себе — человеку придёт push (если он такие хочет).
  const tellAssignee = (who: string | null, title: string) => {
    if (who && who !== userId) notifyUser(d, who, 'assign', `${title} — от ${loginOf(d, userId)}`, '/task/tasks');
  };

  if (method === 'POST' && !id) {
    const tid = randomUUID();
    const hh = sharedTo(body.shared);
    const who = assigneeOf(d, hh, body.assignee);
    const title = text(body.title, 200, 'Задача')!;
    d.transaction(() => {
      d.prepare(
        'insert into tasks (id, user_id, household_id, title, note, tags, priority, checklist_id, assignee_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        tid,
        userId,
        hh,
        title,
        text(body.note, 2000, 'Заметка', true),
        tagsFor(d, userId, body.tags),
        priority(body.priority),
        checklistId(body.checklist_id),
        who,
      );
      tellAssignee(who, title);
    })();
    return { id: tid };
  }

  const t = findTask(d, userId, id);
  if (!t) throw new HttpError(404, 'Задача не найдена.');

  if (method === 'PATCH' && !action) {
    d.transaction(() => {
      const set = (col: string, v: unknown) => d.prepare(`update tasks set ${col} = ? where id = ?`).run(v, t.id);
      if (body.title !== undefined) set('title', text(body.title, 200, 'Задача'));
      if (body.note !== undefined) set('note', text(body.note, 2000, 'Заметка', true));
      if (body.tags !== undefined) set('tags', tagsFor(d, userId, body.tags));
      if (body.priority !== undefined) set('priority', priority(body.priority));
      if (body.checklist_id !== undefined) set('checklist_id', checklistId(body.checklist_id));
      // Сделать общей может любой, кто видит; сделать личной — только автор:
      // иначе общая задача пропала бы у остальных без их ведома.
      if (body.shared !== undefined) {
        if (!body.shared && t.household_id && t.user_id !== userId) throw new HttpError(403, 'Сделать личной может только автор.');
        set('household_id', sharedTo(body.shared));
        if (!body.shared) set('assignee_id', null);
      }
      if (body.assignee !== undefined) {
        const hh = body.shared === false ? null : body.shared ? householdOf(d, userId) : t.household_id;
        const who = assigneeOf(d, hh, body.assignee);
        set('assignee_id', who);
        if (who !== t.assignee_id) tellAssignee(who, body.title !== undefined ? String(body.title).trim() : t.title);
      }
    })();
    return { ok: true };
  }

  if (method === 'DELETE' && !action) {
    if (t.household_id && t.user_id !== userId) throw new HttpError(403, 'Удалить общую задачу может только автор.');
    d.prepare('delete from tasks where id = ?').run(t.id);
    return { ok: true };
  }

  // Выполнить; day — местная дата устройства.
  if (method === 'POST' && action === 'done') {
    const today = day(body.day);
    if (t.done_at) return { ok: true };
    d.transaction(() => {
      d.prepare('insert into task_log (task_id, user_id, day) values (?, ?, ?)').run(t.id, userId, today);
      d.prepare('update tasks set done_at = ? where id = ?').run(today, t.id);
      if (t.household_id) notifyFamily(d, userId, 'done', `${t.title} (${loginOf(d, userId)})`, '/task/tasks', t.household_id);
    })();
    return { ok: true };
  }

  // Отменить сегодняшнюю отметку.
  if (method === 'POST' && action === 'undo') {
    const today = day(body.day);
    d.transaction(() => {
      d.prepare('delete from task_log where task_id = ? and day = ?').run(t.id, today);
      d.prepare('update tasks set done_at = null where id = ?').run(t.id);
    })();
    return { ok: true };
  }

  return undefined;
}
