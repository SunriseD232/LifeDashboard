import { occurrenceKey } from './occurrences';
import { dueDay, occursOn } from './recur';
import type { Reminder } from './types';

/**
 * Что приходится на день — для календаря в «Задачах» и на Главной:
 * напоминания на своё время, и будущие разы повторов. «После выполнения» —
 * только в ближайший раз (просрочено — сегодня): дальше зависит от отметки.
 */

export interface AgendaItem {
  id: string;
  title: string;
  time: string;
  /** Отмечено (знаем только про сегодня). */
  done: boolean;
  /** Каждый день — в точках календаря не показываем: они были бы на всех днях. */
  daily: boolean;
  key: string;
}

export function agendaFor(day: string, reminders: Reminder[], today: string, doneToday: ReadonlySet<string> = new Set()): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const r of reminders) {
    let on: boolean;
    if (r.rule.kind === 'after') {
      const due = dueDay(r.rule, r.last_done);
      on = day === (due < today ? today : due) || (day === today && r.last_done === today);
    } else on = occursOn(r.rule, day, r.last_done);
    if (!on) continue;
    for (const slot of r.times) {
      const key = occurrenceKey(r.id, slot);
      const daily = r.rule.kind === 'repeat' && r.rule.unit === 'day' && r.rule.every === 1;
      out.push({ id: r.id, title: r.title, time: slot, done: day === today && doneToday.has(key), daily, key: `${key}:${day}` });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Сетка месяца: недели с понедельника, 5–6 строк по 7 дней. */
export function monthGrid(month: string): string[][] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const shift = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(y, m - 1, 1 - shift);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((shift + days) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => new Date(start + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10)),
  );
}
