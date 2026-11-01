import type Database from 'better-sqlite3';
import type { Rule } from '@/lib/recur';
import type { Priority, Reminder, Snooze } from '@/lib/types';
import { visibleWhere } from './household';

/**
 * Чтение напоминаний из базы — для API (src/server/api/*) и рассылки push
 * (src/lib/push.ts). last_done — последний день с отметкой: от него считает
 * повтор «после выполнения».
 */

interface Row {
  id: string;
  title: string;
  times: string;
  rule: string;
  checklist_id: string | null;
  last_done: string | null;
  nag: number | null;
  tags: string;
  priority: number;
  note: string | null;
  checklist_title?: string | null;
  user_id: string;
  household_id: string | null;
  assignee_id: string | null;
  assignee: string | null;
  author: string | null;
}

/** На сервере ещё и чьё оно и кому поручено — для рассылки. */
export type StoredReminder = Reminder & { checklist_title: string | null; user_id: string; assignee_id: string | null };

/** Свои напоминания и общие напоминания семьи. */
export function readReminders(d: Database.Database, userId: string): StoredReminder[] {
  const v = visibleWhere(d, userId, 'r');
  const rows = d
    .prepare(
      `select r.id, r.title, r.times, r.rule, r.checklist_id, r.nag, r.tags, r.priority, r.note, c.title as checklist_title,
         r.user_id, r.household_id, r.assignee_id, a.login as assignee, u.login as author,
         (select max(day) from reminder_done x where x.reminder_id = r.id) as last_done
       from reminders r left join checklists c on c.id = r.checklist_id
         left join users a on a.id = r.assignee_id left join users u on u.id = r.user_id
       where ${v.where}
       order by r.created_at`,
    )
    .all(...v.params) as Row[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    times: JSON.parse(r.times) as string[],
    rule: JSON.parse(r.rule) as Rule,
    checklist_id: r.checklist_id,
    checklist_title: r.checklist_title ?? null,
    last_done: r.last_done,
    nag: r.nag ?? null,
    tags: JSON.parse(r.tags) as string[],
    priority: r.priority as Priority,
    note: r.note,
    household_id: r.household_id,
    assignee: r.assignee,
    author: r.user_id === userId ? null : r.author,
    user_id: r.user_id,
    assignee_id: r.assignee_id,
  }));
}

/** Одно напоминание, если оно видно: своё или общее семьи. */
export function findReminder(d: Database.Database, userId: string, id: string | undefined) {
  if (!id) return null;
  const v = visibleWhere(d, userId, 'r');
  return (
    (d.prepare(`select r.id, r.user_id, r.household_id, r.assignee_id, r.title, r.times, r.rule from reminders r where r.id = ? and ${v.where}`).get(id, ...v.params) as
      | { id: string; user_id: string; household_id: string | null; assignee_id: string | null; title: string; times: string; rule: string }
      | undefined) ?? null
  );
}

/**
 * Отметки, что видит человек: свои — и чужие у общих напоминаний (сделал
 * один — сделано для всех).
 */
const DONE_SQL = `from reminder_done x join reminders r on r.id = x.reminder_id join users u on u.id = x.user_id
  where x.day = ? and (x.user_id = ? or (r.household_id is not null and r.household_id = (select household_id from household_members where user_id = ?)))`;

/** Отметки «сделано» за день — ключи `${id}@${slot}`. */
export function doneKeys(d: Database.Database, userId: string, day: string): string[] {
  return (
    d.prepare(`select x.reminder_id, x.slot ${DONE_SQL}`).all(day, userId, userId) as {
      reminder_id: string;
      slot: string;
    }[]
  ).map((r) => `${r.reminder_id}@${r.slot}`);
}

/** Кто из семьи отметил общее: ключ `${id}@${slot}` → логин (кроме своих отметок). */
export function doneByOthers(d: Database.Database, userId: string, day: string): Record<string, string> {
  const rows = d.prepare(`select x.reminder_id, x.slot, u.login ${DONE_SQL} and x.user_id <> ?`).all(day, userId, userId, userId) as {
    reminder_id: string;
    slot: string;
    login: string;
  }[];
  return Object.fromEntries(rows.map((r) => [`${r.reminder_id}@${r.slot}`, r.login]));
}

export function snoozesOn(d: Database.Database, userId: string, day: string): Snooze[] {
  return d
    .prepare('select reminder_id, slot, at from reminder_snooze where user_id = ? and day = ?')
    .all(userId, day) as Snooze[];
}
