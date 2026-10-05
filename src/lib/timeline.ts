import { minutesOf } from './dates';
import { occurrenceKey, occurrencesOn, type Occurrence } from './occurrences';
import { addDays, dueDay } from './recur';
import type { Task } from './tasks';
import type { Reminder, Snooze } from './types';

/**
 * Один список «Задачи»: с напоминанием — по дням, без напоминания — отдельно.
 *
 *   Просрочено       — разовые напоминания прошлых дней, так и не отмеченные;
 *   Сегодня, Завтра  — напоминания дня по времени;
 *   Позже            — разовые напоминания по датам (повторяющиеся дальше
 *                      завтра не разворачиваем — иначе «каждый день» залил бы
 *                      список; их видно в календаре);
 *   Без напоминания  — задачи-список, важные сверху.
 */

export type Row =
  | { kind: 'task'; key: string; task: Task }
  | { kind: 'rem'; key: string; occ: Occurrence; date: string; time: string };

export type GroupId = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';

export interface Group {
  id: GroupId;
  title: string;
  rows: Row[];
}

const TITLES: Record<GroupId, string> = { overdue: 'Просрочено', today: 'Сегодня', tomorrow: 'Завтра', later: 'Позже', none: 'Без напоминания' };

const remRow = (occ: Occurrence, date: string): Row => ({ kind: 'rem', key: `r:${occ.key}:${date}`, occ, date, time: occ.snoozedTo ?? occ.slot });
const byTime = (a: Row, b: Row) => (a.kind === 'rem' && b.kind === 'rem' ? a.date.localeCompare(b.date) || minutesOf(a.time) - minutesOf(b.time) : 0);
const plain = (r: Reminder, slot: string): Occurrence => ({ reminder: r, slot, key: occurrenceKey(r.id, slot), done: false, snoozedTo: null });

/** Разовое напоминание прошлого дня, ни разу не отмеченное. */
export function isOverdue(r: Reminder, today: string): boolean {
  return r.rule.kind === 'once' && r.rule.date < today && !r.last_done;
}

/** Задачи без напоминания: важные сверху, дальше — как заводили. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.priority - a.priority);
}

export function timeline(tasks: Task[], reminders: Reminder[], today: string, done: ReadonlySet<string> = new Set(), snoozes: Snooze[] = []): Group[] {
  const tomorrow = addDays(today, 1);
  const onceAfter = (from: string) =>
    reminders
      .filter((r) => r.rule.kind === 'once' && r.rule.date > from && !r.last_done)
      .flatMap((r) => r.times.map((slot) => remRow(plain(r, slot), (r.rule as { date: string }).date)));

  const groups: Group[] = [
    {
      id: 'overdue',
      title: TITLES.overdue,
      rows: reminders
        .filter((r) => isOverdue(r, today))
        .flatMap((r) => r.times.map((slot) => remRow(plain(r, slot), (r.rule as { date: string }).date)))
        .sort(byTime),
    },
    { id: 'today', title: TITLES.today, rows: occurrencesOn(reminders, today, done, snoozes).map((o) => remRow(o, today)).sort(byTime) },
    {
      id: 'tomorrow',
      title: TITLES.tomorrow,
      // «После выполнения» — только в свой ближайший раз: просроченное уже
      // висит в «Сегодня» и завтра не повторяется.
      rows: occurrencesOn(reminders, tomorrow)
        .filter((o) => (o.reminder.rule.kind === 'once' ? !o.reminder.last_done : o.reminder.rule.kind !== 'after' || dueDay(o.reminder.rule, o.reminder.last_done) === tomorrow))
        .map((o) => remRow(o, tomorrow))
        .sort(byTime),
    },
    { id: 'later', title: TITLES.later, rows: onceAfter(tomorrow).sort(byTime) },
    { id: 'none', title: TITLES.none, rows: sortTasks(tasks.filter((t) => !t.done_at)).map((task) => ({ kind: 'task', key: `t:${task.id}`, task })) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** Сколько ещё надо сделать сегодня: просрочено + сегодня, без отмеченного. */
export function leftToday(groups: Group[]): number {
  return groups
    .filter((g) => g.id === 'overdue' || g.id === 'today')
    .reduce((n, g) => n + g.rows.filter((r) => (r.kind === 'rem' ? !r.occ.done : true)).length, 0);
}
