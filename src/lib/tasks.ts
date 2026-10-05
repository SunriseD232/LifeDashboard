import { diffDays, weekday, WEEKDAY_SHORT } from './recur';
import type { Priority } from './types';

/**
 * Задачи. Два вида: без напоминания — просто список «сделать», без даты
 * (здесь, Task); с напоминанием — дата, время и повтор (Reminder,
 * src/lib/types.ts). У обоих — метки, важность и чек-лист.
 */

export interface Task {
  id: string;
  title: string;
  note: string | null;
  tags: string[];
  priority: Priority;
  checklist_id: string | null;
  done_at: string | null;
  /** Общая задача семьи (src/server/household.ts) или null — личная. */
  household_id: string | null;
  /** Кто завёл — для общих задач показываем, если не я. */
  author: string | null;
}

export const PRIORITIES: { v: Priority; label: string; short: string }[] = [
  { v: 0, label: 'Нет', short: '' },
  { v: 1, label: 'Низкая', short: 'низкая' },
  { v: 2, label: 'Средняя', short: 'средняя' },
  { v: 3, label: 'Высокая', short: 'высокая' },
];

export function isPriority(v: unknown): v is Priority {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/** Все метки — свои и встреченные у задач (общие задачи семьи — с чужими). */
export function knownTags(own: string[], ...lists: { tags: string[] }[][]): string[] {
  const seen = new Set(own.map((t) => t.toLowerCase()));
  const extra = lists
    .flat()
    .flatMap((x) => x.tags)
    .filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  return [...own, ...extra.sort((a, b) => a.localeCompare(b, 'ru'))];
}

/** Метки из ввода: без пробелов по краям, без повторов (без учёта регистра), до 10. */
export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const t = x.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 10);
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Короткая дата для списка: «вт 6» на ближайшую неделю, дальше «12 окт». */
export function shortDate(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n >= 0 && n < 7) return `${WEEKDAY_SHORT[weekday(day)]} ${Number(day.slice(8))}`;
  return `${Number(day.slice(8))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
}
