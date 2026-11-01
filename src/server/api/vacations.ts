import { randomUUID } from 'node:crypto';
import { overlaps } from '@/lib/vacations';
import { DAY_RE, HttpError, own, text, type Ctx } from '../http';
import { readVacationList, readVacations } from '../vacationStore';

const day = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, `Неверная дата «${field}».`);
  return v;
};

/**
 * Отпуска: /api/vacations — GET { list, allowance, family }; POST { title, start, end, pause, shared (видно семье) };
 * PATCH /:id — то же, что изменилось; DELETE /:id;
 * PUT /vacations/allowance { days } — сколько дней положено в год (null — не считать).
 */
export function vacations({ d, userId, method, body, id }: Ctx): unknown {
  if (method === 'GET' && !id) return readVacations(d, userId);

  if (method === 'PUT' && id === 'allowance') {
    const n = body.days;
    if (n !== null && (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 366)) throw new HttpError(400, 'Дней в году — целым числом от 0 до 366.');
    d.prepare('insert into user_settings (user_id, vacation_days) values (?, ?) on conflict(user_id) do update set vacation_days = excluded.vacation_days').run(userId, n);
    return readVacations(d, userId);
  }

  const check = (start: string, end: string, except?: string) => {
    if (end < start) throw new HttpError(400, 'Конец отпуска раньше начала.');
    const clash = overlaps(readVacationList(d, userId), start, end, except);
    if (clash) throw new HttpError(400, `Пересекается с «${clash.title}».`);
  };

  if (method === 'POST' && !id) {
    const start = day(body.start, 'С');
    const end = day(body.end, 'По');
    check(start, end);
    const vid = randomUUID();
    d.prepare('insert into vacations (id, user_id, title, start, end, pause, shared) values (?, ?, ?, ?, ?, ?, ?)').run(
      vid,
      userId,
      text(body.title, 60, 'Название', true) ?? 'Отпуск',
      start,
      end,
      body.pause === false ? 0 : 1,
      body.shared ? 1 : 0,
    );
    return { id: vid, ...readVacations(d, userId) };
  }

  if (!id) return undefined;
  const cur = own(readVacationList(d, userId).find((v) => v.id === id), 'Отпуск');

  if (method === 'PATCH') {
    const start = body.start !== undefined ? day(body.start, 'С') : cur.start;
    const end = body.end !== undefined ? day(body.end, 'По') : cur.end;
    check(start, end, id);
    const title = body.title !== undefined ? text(body.title, 60, 'Название', true) ?? 'Отпуск' : cur.title;
    const pause = body.pause !== undefined ? !!body.pause : cur.pause;
    const shared = body.shared !== undefined ? !!body.shared : cur.shared;
    d.prepare('update vacations set title = ?, start = ?, end = ?, pause = ?, shared = ? where id = ? and user_id = ?').run(title, start, end, pause ? 1 : 0, shared ? 1 : 0, id, userId);
    return readVacations(d, userId);
  }

  if (method === 'DELETE') {
    d.prepare('delete from vacations where id = ? and user_id = ?').run(id, userId);
    return readVacations(d, userId);
  }
  return undefined;
}
