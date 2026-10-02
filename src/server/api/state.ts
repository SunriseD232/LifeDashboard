import { userLogin } from '@/lib/auth';
import type { Checklist } from '@/lib/types';
import { doneKeys, readReminders, snoozesOn } from '../reminderStore';
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
    // Без названия чек-листа — экрану оно приходит из самих чек-листов.
    const reminders = readReminders(d, userId).map(({ checklist_title: _, ...r }) => r);
    const done = doneKeys(d, userId, day);
    const snoozed = snoozesOn(d, userId, day);
    return { checklists, items, reminders, done, snoozed, login: userLogin(userId) };
  }
  return undefined;
}
