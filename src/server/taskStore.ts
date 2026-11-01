import type Database from 'better-sqlite3';
import type { Task } from '@/lib/tasks';
import type { Priority } from '@/lib/types';
import { visibleWhere } from './household';

/**
 * Задачи без напоминания из базы: личные и общие задачи семьи. Каждый
 * доступ — через visible(): чужую задачу не найти даже по известному id.
 */

interface Row {
  id: string;
  user_id: string;
  household_id: string | null;
  title: string;
  note: string | null;
  tags: string;
  priority: number;
  checklist_id: string | null;
  done_at: string | null;
  author: string | null;
  assignee_id: string | null;
  assignee: string | null;
  done_by_id: string | null;
  done_by: string | null;
}

const visible = (d: Database.Database, userId: string) => visibleWhere(d, userId, 't');

function toTask(r: Row, userId: string): Task {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    tags: JSON.parse(r.tags) as string[],
    priority: r.priority as Priority,
    checklist_id: r.checklist_id,
    done_at: r.done_at,
    household_id: r.household_id,
    author: r.user_id === userId ? null : r.author,
    assignee: r.assignee,
    done_by: r.done_by_id && r.done_by_id !== userId ? r.done_by : null,
  };
}

// Кто выполнил — последняя отметка в task_log.
const SELECT = `select t.id, t.user_id, t.household_id, t.title, t.note, t.tags, t.priority, t.checklist_id, t.done_at, u.login as author,
    t.assignee_id, a.login as assignee, l.user_id as done_by_id, lu.login as done_by
  from tasks t left join users u on u.id = t.user_id left join users a on a.id = t.assignee_id
    left join task_log l on l.rowid = (select max(rowid) from task_log where task_id = t.id and t.done_at is not null)
    left join users lu on lu.id = l.user_id`;

/** Открытые задачи и закрытые сегодня (для «Сделано сегодня»). */
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

/** Одна задача, если она видна пользователю. */
export function findTask(d: Database.Database, userId: string, id: string | undefined): (Task & { user_id: string; assignee_id: string | null }) | null {
  if (!id) return null;
  const v = visible(d, userId);
  const r = d.prepare(`${SELECT} where t.id = ? and ${v.where}`).get(id, ...v.params) as Row | undefined;
  return r ? { ...toTask(r, userId), user_id: r.user_id, assignee_id: r.assignee_id } : null;
}
