import type Database from 'better-sqlite3';
import type { Rule } from '@/lib/recur';
import type { Task } from '@/lib/tasks';
import { householdOf } from './household';

/**
 * Дела из базы: личные и общие дела семьи. Каждый доступ — через visible():
 * чужое дело не найти даже по известному id.
 */

interface Row {
  id: string;
  user_id: string;
  household_id: string | null;
  title: string;
  note: string | null;
  tag: string | null;
  due_date: string | null;
  rule: string | null;
  done_at: string | null;
  author: string | null;
}

/** Условие видимости для таблицы tasks под псевдонимом t и параметры к нему. */
export function visible(d: Database.Database, userId: string): { where: string; params: (string | null)[] } {
  return { where: '(t.user_id = ? or (t.household_id is not null and t.household_id = ?))', params: [userId, householdOf(d, userId)] };
}

function toTask(r: Row, userId: string): Task {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    tag: r.tag,
    due_date: r.due_date,
    rule: r.rule ? (JSON.parse(r.rule) as Rule) : null,
    done_at: r.done_at,
    household_id: r.household_id,
    author: r.user_id === userId ? null : r.author,
  };
}

const SELECT = `select t.id, t.user_id, t.household_id, t.title, t.note, t.tag, t.due_date, t.rule, t.done_at, u.login as author
  from tasks t left join users u on u.id = t.user_id`;

/** Открытые дела и закрытые сегодня (для «Сделано сегодня»). */
export function readTasks(d: Database.Database, userId: string, today: string): { tasks: Task[]; doneToday: string[] } {
  const v = visible(d, userId);
  const rows = d
    .prepare(`${SELECT} where ${v.where} and (t.done_at is null or t.done_at >= ?) order by t.created_at`)
    .all(...v.params, today) as Row[];
  const doneToday = (
    d.prepare(`select distinct l.task_id from task_log l join tasks t on t.id = l.task_id where ${v.where} and l.day = ?`).all(...v.params, today) as {
      task_id: string;
    }[]
  ).map((r) => r.task_id);
  return { tasks: rows.map((r) => toTask(r, userId)), doneToday };
}

/** Одно дело, если оно видно пользователю. */
export function findTask(d: Database.Database, userId: string, id: string | undefined): (Task & { user_id: string }) | null {
  if (!id) return null;
  const v = visible(d, userId);
  const r = d.prepare(`${SELECT} where t.id = ? and ${v.where}`).get(id, ...v.params) as Row | undefined;
  return r ? { ...toTask(r, userId), user_id: r.user_id } : null;
}
