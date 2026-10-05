import { addDays, dayLabel, diffDays, nextOccurrence, weekday, WEEKDAY_SHORT, type Rule } from './recur';

/**
 * Дела. Без даты — «срочно»: сделать как можно скорее. С датой — «позже»,
 * а за день до срока (и всё просроченное) — тоже «срочно». Повторяющееся
 * дело (rule) после выполнения переносит срок на следующий раз.
 *
 * Здесь только расчёты — для экрана, главной, API и push; без базы.
 */

export interface Task {
  id: string;
  title: string;
  note: string | null;
  tag: string | null;
  due_date: string | null;
  rule: Rule | null;
  done_at: string | null;
  /** Общее дело семьи (src/server/household.ts) или null — личное. */
  household_id: string | null;
  /** Кто завёл — для общих дел показываем, если не я. */
  author: string | null;
}

export type Bucket = 'urgent' | 'later' | 'done';

export function bucket(t: Pick<Task, 'done_at' | 'due_date'>, today: string): Bucket {
  if (t.done_at) return 'done';
  if (!t.due_date) return 'urgent';
  return t.due_date <= addDays(today, 1) ? 'urgent' : 'later';
}

export type Tone = 'danger' | 'warm' | 'muted';

/** Подпись срока: «просрочено на 2 дня», «сегодня», «завтра», «пт 9», «12 октября». */
export function dueLabel(due: string | null, today: string): { text: string; tone: Tone } | null {
  if (!due) return null;
  const n = diffDays(today, due);
  if (n < 0) {
    const k = -n;
    const w = k % 10 === 1 && k % 100 !== 11 ? 'день' : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 12 || k % 100 > 14) ? 'дня' : 'дней';
    return { text: `просрочено на ${k} ${w}`, tone: 'danger' };
  }
  if (n === 0) return { text: 'сегодня', tone: 'danger' };
  if (n === 1) return { text: 'завтра', tone: 'warm' };
  if (n < 7) return { text: `${WEEKDAY_SHORT[weekday(due)]} ${Number(due.slice(8))}`, tone: 'muted' };
  return { text: dayLabel(due), tone: 'muted' };
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Короткая дата для списка: «вт 6» на ближайшую неделю, дальше «12 окт». */
export function shortDate(due: string, today: string): string {
  const n = diffDays(today, due);
  if (n >= 0 && n < 7) return `${WEEKDAY_SHORT[weekday(due)]} ${Number(due.slice(8))}`;
  return `${Number(due.slice(8))} ${MONTHS_SHORT[Number(due.slice(5, 7)) - 1]}`;
}

const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

/** Группа дела «позже» по сроку. */
export function laterGroup(due: string, today: string): string {
  const sunday = addDays(today, (7 - weekday(today)) % 7);
  if (due <= sunday) return 'На этой неделе';
  if (due <= addDays(sunday, 7)) return 'На следующей неделе';
  const m = Number(due.slice(5, 7)) - 1;
  if (due.slice(0, 7) === today.slice(0, 7)) return `Позже в ${MONTHS_PREP[m]}`;
  if (due.slice(0, 4) === today.slice(0, 4) || diffDays(today, due) < 180) return `В ${MONTHS_PREP[m]}`;
  return 'Позже';
}

/** Дела «позже», сгруппированные и упорядоченные по сроку. */
export function groupLater<T extends Pick<Task, 'due_date'>>(tasks: T[], today: string): { title: string; tasks: T[] }[] {
  const sorted = tasks.filter((t) => t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const out: { title: string; tasks: T[] }[] = [];
  for (const t of sorted) {
    const title = laterGroup(t.due_date!, today);
    const last = out[out.length - 1];
    if (last?.title === title) last.tasks.push(t);
    else out.push({ title, tasks: [t] });
  }
  return out;
}

/** Порядок «срочных»: просроченные и сегодняшние, потом завтрашние, потом без даты. */
export function sortUrgent<T extends Pick<Task, 'due_date' | 'title'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
}

/**
 * Следующий срок повторяющегося дела после выполнения в день `day`: от
 * более позднего из срока и дня выполнения — просроченное «по понедельникам»
 * , сделанное в среду, переедет на следующий понедельник, а не на вчерашний.
 * null — повторов больше нет, дело закрывается.
 */
export function nextDue(rule: Rule, due: string | null, day: string): string | null {
  if (rule.kind === 'once') return null;
  const base = due && due > day ? due : day;
  return nextOccurrence(rule, addDays(base, 1), day);
}

/** Первый срок нового повторяющегося дела. */
export function firstDue(rule: Rule, today: string): string | null {
  return nextOccurrence(rule, today);
}

/**
 * Напоминания о сроках: в своё время (deadlineTime, местное) — за день до
 * срока и в сам день. Окно 10 минут, как у напоминаний.
 */
export function deadlineNotices<T extends Pick<Task, 'due_date' | 'done_at'>>(
  tasks: T[],
  today: string,
  minutesNow: number,
  deadlineTime: string,
): { task: T; kind: 'today' | 'tomorrow' }[] {
  const [h, m] = deadlineTime.split(':').map(Number);
  const late = minutesNow - (h * 60 + m);
  if (late < 0 || late > 10) return [];
  const tomorrow = addDays(today, 1);
  const out: { task: T; kind: 'today' | 'tomorrow' }[] = [];
  for (const t of tasks) {
    if (t.done_at || !t.due_date) continue;
    if (t.due_date === today) out.push({ task: t, kind: 'today' });
    else if (t.due_date === tomorrow) out.push({ task: t, kind: 'tomorrow' });
  }
  return out;
}

/** Все метки — у дел и у напоминаний (дело со временем хранится напоминанием). */
export function knownTags(...lists: { tag: string | null }[][]): string[] {
  return [...new Set(lists.flat().map((x) => x.tag).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru'));
}
