import type Database from 'better-sqlite3';
import type { Rule } from '@/lib/recur';
import type { Reminder, Snooze } from '@/lib/types';

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
  tag: string | null;
  checklist_title?: string | null;
}

export type StoredReminder = Reminder & { checklist_title: string | null };

export function readReminders(d: Database.Database, userId: string): StoredReminder[] {
  const rows = d
    .prepare(
      `select r.id, r.title, r.times, r.rule, r.checklist_id, r.nag, r.tag, c.title as checklist_title,
         (select max(day) from reminder_done x where x.reminder_id = r.id) as last_done
       from reminders r left join checklists c on c.id = r.checklist_id
       where r.user_id = ?
       order by r.created_at`,
    )
    .all(userId) as Row[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    times: JSON.parse(r.times) as string[],
    rule: JSON.parse(r.rule) as Rule,
    checklist_id: r.checklist_id,
    checklist_title: r.checklist_title ?? null,
    last_done: r.last_done,
    nag: r.nag ?? null,
    tag: r.tag ?? null,
  }));
}

/** Отметки «сделано» за день — ключи `${id}@${slot}`. */
export function doneKeys(d: Database.Database, userId: string, day: string): string[] {
  return (
    d.prepare('select reminder_id, slot from reminder_done where user_id = ? and day = ?').all(userId, day) as {
      reminder_id: string;
      slot: string;
    }[]
  ).map((r) => `${r.reminder_id}@${r.slot}`);
}

export function snoozesOn(d: Database.Database, userId: string, day: string): Snooze[] {
  return d
    .prepare('select reminder_id, slot, at from reminder_snooze where user_id = ? and day = ?')
    .all(userId, day) as Snooze[];
}
