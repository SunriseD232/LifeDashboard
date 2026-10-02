import { userLogin } from '@/lib/auth';
import type { Checklist, Reminder } from '@/lib/types';
import { DAY_RE, HttpError, itemRow, type Ctx } from '../http';

/** Всё сразу: экран открывается одним запросом (GET /api/state?day=). */
export function state({ d, userId, method, req }: Ctx): unknown {
  if (method === 'GET') {
    const day = req.nextUrl.searchParams.get('day') ?? '';
    if (!DAY_RE.test(day)) throw new HttpError(400, 'Неверная дата.');
    const checklists = d
      .prepare('select id, title, icon, position from checklists where user_id = ? order by position, created_at')
      .all(userId) as Checklist[];
    const items = (
      d
        .prepare(
          'select id, checklist_id, title, group_name, note, done, position from checklist_items where user_id = ? order by position, created_at',
        )
        .all(userId) as Record<string, unknown>[]
    ).map(itemRow);
    const reminders = d
      .prepare(
        'select id, title, at_time, repeat, on_date, checklist_id from reminders where user_id = ? order by at_time, created_at',
      )
      .all(userId) as Reminder[];
    const done = (
      d.prepare('select reminder_id from reminder_done where user_id = ? and day = ?').all(userId, day) as {
        reminder_id: string;
      }[]
    ).map((r) => r.reminder_id);
    return { checklists, items, reminders, done, login: userLogin(userId) };
  }
  return undefined;
}
