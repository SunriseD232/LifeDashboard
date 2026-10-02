import { occursOn } from './recur';
import type { Reminder, Snooze } from './types';

/**
 * Одно «появление» дела в день: напоминание × время. У «таблеток в 9:00 и
 * 21:00» в сутках два появления, у каждого своя отметка «сделано» — ключ
 * `${id}@${slot}` (так же хранится на сервере: reminder_done.slot).
 */
export interface Occurrence {
  reminder: Reminder;
  slot: string;
  key: string;
  done: boolean;
  /** На какое время отложено сегодня, если отложено. */
  snoozedTo: string | null;
}

export const occurrenceKey = (id: string, slot: string) => `${id}@${slot}`;

/** Появления дел в этот день, по времени. */
export function occurrencesOn(
  reminders: Reminder[],
  day: string,
  doneKeys: ReadonlySet<string> = new Set(),
  snoozes: Snooze[] = [],
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of reminders) {
    if (!occursOn(r.rule, day, r.last_done)) continue;
    for (const slot of r.times) {
      const key = occurrenceKey(r.id, slot);
      const sn = snoozes.find((s) => s.reminder_id === r.id && s.slot === slot);
      out.push({ reminder: r, slot, key, done: doneKeys.has(key), snoozedTo: sn?.at ?? null });
    }
  }
  return out.sort((a, b) => (a.snoozedTo ?? a.slot).localeCompare(b.snoozedTo ?? b.slot) || a.reminder.title.localeCompare(b.reminder.title));
}
