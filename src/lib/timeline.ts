import { minutesOf } from './dates';
import { occurrenceKey, occurrencesOn, type Occurrence } from './occurrences';
import { addDays, dueDay } from './recur';
import type { Task } from './tasks';
import type { Reminder, Snooze } from './types';

/**
 * Один список «Дела» по дням: дела и напоминания вместе.
 *
 *   Просрочено — дела со сроком раньше сегодняшнего;
 *   Сегодня    — напоминания дня по времени, потом дела на сегодня;
 *   Завтра     — так же на завтра;
 *   Позже      — дела с дальними сроками и разовые напоминания по датам
 *                (повторяющиеся напоминания дальше завтра не разворачиваем —
 *                они в фильтре «Повторы», иначе «каждый день» залил бы список);
 *   Без срока  — дела без даты.
 */

export type Row =
  | { kind: 'task'; key: string; task: Task; date: string | null }
  | { kind: 'rem'; key: string; occ: Occurrence; date: string; time: string };

export type GroupId = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';

export interface Group {
  id: GroupId;
  title: string;
  rows: Row[];
}

const TITLES: Record<GroupId, string> = { overdue: 'Просрочено', today: 'Сегодня', tomorrow: 'Завтра', later: 'Позже', none: 'Без срока' };

const taskRow = (task: Task): Row => ({ kind: 'task', key: `t:${task.id}`, task, date: task.due_date });
const remRow = (occ: Occurrence, date: string): Row => ({ kind: 'rem', key: `r:${occ.key}:${date}`, occ, date, time: occ.snoozedTo ?? occ.slot });

/** По времени напоминаний, дела дня — следом. */
function dayOrder(rows: Row[]): Row[] {
  const timed = rows.filter((r): r is Extract<Row, { kind: 'rem' }> => r.kind === 'rem').sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  return [...timed, ...rows.filter((r) => r.kind === 'task')];
}

export function timeline(tasks: Task[], reminders: Reminder[], today: string, done: ReadonlySet<string> = new Set(), snoozes: Snooze[] = []): Group[] {
  const tomorrow = addDays(today, 1);
  const open = tasks.filter((t) => !t.done_at);
  const byDue = (pred: (d: string) => boolean) => open.filter((t) => t.due_date !== null && pred(t.due_date));

  const later: Row[] = [
    ...byDue((d) => d > tomorrow).map(taskRow),
    ...reminders
      .filter((r) => r.rule.kind === 'once' && r.rule.date > tomorrow)
      .flatMap((r) => {
        const date = (r.rule as { date: string }).date;
        return r.times.map((slot) => remRow({ reminder: r, slot, key: occurrenceKey(r.id, slot), done: false, snoozedTo: null }, date));
      }),
  ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.kind === 'rem' ? a.time : '').localeCompare(b.kind === 'rem' ? b.time : ''));

  const groups: Group[] = [
    { id: 'overdue', title: TITLES.overdue, rows: byDue((d) => d < today).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).map(taskRow) },
    { id: 'today', title: TITLES.today, rows: dayOrder([...occurrencesOn(reminders, today, done, snoozes).map((o) => remRow(o, today)), ...byDue((d) => d === today).map(taskRow)]) },
    {
      id: 'tomorrow',
      title: TITLES.tomorrow,
      rows: dayOrder([
        // «После выполнения» — только в свой ближайший раз: просроченное уже
        // висит в «Сегодня» и завтра не повторяется.
        ...occurrencesOn(reminders, tomorrow)
          .filter((o) => o.reminder.rule.kind !== 'after' || dueDay(o.reminder.rule, o.reminder.last_done) === tomorrow)
          .map((o) => remRow(o, tomorrow)),
        ...byDue((d) => d === tomorrow).map(taskRow),
      ]),
    },
    { id: 'later', title: TITLES.later, rows: later },
    { id: 'none', title: TITLES.none, rows: open.filter((t) => t.due_date === null).map(taskRow) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** Сколько ещё надо сделать сегодня: просрочено + сегодня, без отмеченного. */
export function leftToday(groups: Group[]): number {
  return groups
    .filter((g) => g.id === 'overdue' || g.id === 'today')
    .reduce((n, g) => n + g.rows.filter((r) => (r.kind === 'rem' ? !r.occ.done : true)).length, 0);
}
