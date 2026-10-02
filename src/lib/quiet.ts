import { minutesOf } from './dates';
import type { Occurrence } from './occurrences';
import type { Task } from './tasks';

/**
 * Тихие часы и вечерний итог — чистые функции для рассылки (src/lib/push.ts)
 * и экрана «Итог дня».
 *
 * Тихие часы могут переходить через полночь (23:00–07:00) или нет (13:00–15:00).
 * Ночью push не шлём; что пришлось на тихие часы и не отмечено — одним
 * сообщением, когда они кончатся.
 */

export interface Quiet {
  from: string;
  to: string;
}

export function quietOf(from: string | null, to: string | null): Quiet | null {
  return from && to && from !== to ? { from, to } : null;
}

export function inQuiet(minutes: number, q: Quiet | null): boolean {
  if (!q) return false;
  const f = minutesOf(q.from);
  const t = minutesOf(q.to);
  return f < t ? minutes >= f && minutes < t : minutes >= f || minutes < t;
}

/** Время push с учётом тихих часов: попало в них — переносим на их конец. */
export function outOfQuiet(hm: string, q: Quiet | null): string {
  return inQuiet(minutesOf(hm), q) ? q!.to : hm;
}

/**
 * Что пришлось на сегодняшние тихие часы и так и не отмечено — для одного
 * утреннего сообщения. Поздний вечер (после начала тихих часов) — это уже
 * «сегодня ночью», он ещё не наступил, его не берём.
 */
export function quietMissed(occ: Occurrence[], q: Quiet | null): Occurrence[] {
  if (!q) return [];
  const to = minutesOf(q.to);
  return occ.filter((o) => {
    if (o.done) return false;
    const m = minutesOf(o.snoozedTo ?? o.slot);
    return inQuiet(m, q) && m < to;
  });
}

/** Итог дня: дела со сроком сегодня и раньше и неотмеченные напоминания дня. */
export function reviewItems<T extends Pick<Task, 'due_date' | 'done_at'>>(tasks: T[], occ: Occurrence[], today: string): { tasks: T[]; reminders: Occurrence[] } {
  return {
    tasks: tasks.filter((t) => !t.done_at && t.due_date !== null && t.due_date <= today),
    reminders: occ.filter((o) => !o.done),
  };
}
