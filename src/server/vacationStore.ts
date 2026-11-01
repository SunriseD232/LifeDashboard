import type Database from 'better-sqlite3';
import type { FamilyVacation, Vacation, Vacations } from '@/lib/vacations';
import { householdOf } from './household';

/** Отпуска из базы: свои — и те, что люди из семьи показали семье. */

export function readVacationList(d: Database.Database, userId: string): Vacation[] {
  const rows = d.prepare('select id, title, start, end, pause, shared from vacations where user_id = ? order by start').all(userId) as (Omit<Vacation, 'pause' | 'shared'> & {
    pause: number;
    shared: number;
  })[];
  return rows.map((r) => ({ ...r, pause: !!r.pause, shared: !!r.shared }));
}

/** Отпуска остальных в семье, которые они показали; прошедшие не нужны. */
export function familyVacations(d: Database.Database, userId: string, from: string): FamilyVacation[] {
  const hh = householdOf(d, userId);
  if (!hh) return [];
  return d
    .prepare(
      `select v.id, v.title, v.start, v.end, u.login from vacations v join users u on u.id = v.user_id
       join household_members m on m.user_id = v.user_id and m.household_id = ?
       where v.shared = 1 and v.user_id <> ? and v.end >= ? order by v.start`,
    )
    .all(hh, userId, from) as FamilyVacation[];
}

export function readVacations(d: Database.Database, userId: string): Vacations {
  const row = d.prepare('select vacation_days from user_settings where user_id = ?').get(userId) as { vacation_days: number | null } | undefined;
  // Год назад — хватит и на «прошедшие в этом году».
  const from = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
  return { list: readVacationList(d, userId), allowance: row?.vacation_days ?? null, family: familyVacations(d, userId, from) };
}
