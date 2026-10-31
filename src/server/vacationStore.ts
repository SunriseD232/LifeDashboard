import type Database from 'better-sqlite3';
import type { Vacation, Vacations } from '@/lib/vacations';

/** Отпуска из базы — только свои (user_id в каждом запросе). */

export function readVacationList(d: Database.Database, userId: string): Vacation[] {
  const rows = d.prepare('select id, title, start, end, pause from vacations where user_id = ? order by start').all(userId) as (Omit<Vacation, 'pause'> & { pause: number })[];
  return rows.map((r) => ({ ...r, pause: !!r.pause }));
}

export function readVacations(d: Database.Database, userId: string): Vacations {
  const row = d.prepare('select vacation_days from user_settings where user_id = ?').get(userId) as { vacation_days: number | null } | undefined;
  return { list: readVacationList(d, userId), allowance: row?.vacation_days ?? null };
}
