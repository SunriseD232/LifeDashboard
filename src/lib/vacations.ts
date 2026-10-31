/**
 * Отпуска: периоды с датами, счёт дней за год и пауза повторяющихся
 * напоминаний. Общее для сервера (рассылка) и экрана.
 */

export interface Vacation {
  id: string;
  title: string;
  /** Первый и последний день, включительно: 'YYYY-MM-DD'. */
  start: string;
  end: string;
  /** Не присылать повторяющиеся напоминания в эти дни. */
  pause: boolean;
}

export interface Vacations {
  list: Vacation[];
  /** Сколько дней положено в год; null — не считаем. */
  allowance: number | null;
}

const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Календарных дней в промежутке [start, end] включительно. */
export function spanDays(start: string, end: string): number {
  return end < start ? 0 : Math.round((ms(end) - ms(start)) / 86_400_000) + 1;
}

/** Сколько дней отпуска приходится на этот год (отпуск через Новый год делится). */
export function daysInYear(v: Pick<Vacation, 'start' | 'end'>, year: number): number {
  const from = v.start > `${year}-01-01` ? v.start : `${year}-01-01`;
  const to = v.end < `${year}-12-31` ? v.end : `${year}-12-31`;
  return spanDays(from, to);
}

/** Отпуск, в котором этот день, — первый подходящий. */
export function vacationOn(list: Vacation[], day: string): Vacation | null {
  return list.find((v) => v.start <= day && day <= v.end) ?? null;
}

/** Повторяющиеся напоминания в этот день на паузе. */
export function pausedOn(list: Vacation[], day: string): boolean {
  return list.some((v) => v.pause && v.start <= day && day <= v.end);
}

/**
 * Счёт за год: прошедшие дни (до сегодня включительно) и запланированные
 * (с завтрашнего), сколько осталось от положенного.
 */
export function yearCount(list: Vacation[], year: number, today: string, allowance: number | null): { taken: number; planned: number; left: number | null } {
  let taken = 0;
  let planned = 0;
  for (const v of list) {
    const total = daysInYear(v, year);
    if (!total) continue;
    const past = v.start > today ? 0 : daysInYear({ start: v.start, end: v.end < today ? v.end : today }, year);
    taken += past;
    planned += total - past;
  }
  return { taken, planned, left: allowance === null ? null : allowance - taken - planned };
}

/** Пересекается ли период с другими (кроме себя). */
export function overlaps(list: Vacation[], start: string, end: string, except?: string): Vacation | null {
  return list.find((v) => v.id !== except && v.start <= end && start <= v.end) ?? null;
}
