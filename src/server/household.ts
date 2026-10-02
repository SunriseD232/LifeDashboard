import type Database from 'better-sqlite3';

/**
 * Семья — несколько пользователей с общими делами (а дальше — покупками и
 * запасами). Человек состоит не больше чем в одной семье; общая строка
 * помечена household_id и видна всем участникам.
 */

export function householdOf(d: Database.Database, userId: string): string | null {
  const row = d.prepare('select household_id from household_members where user_id = ?').get(userId) as
    | { household_id: string }
    | undefined;
  return row?.household_id ?? null;
}

/**
 * Условие «видно этому человеку» для таблицы с user_id и household_id под
 * псевдонимом alias: своё или общее его семьи. Чужое не найти даже по id.
 */
export function visibleWhere(d: Database.Database, userId: string, alias: string): { where: string; params: (string | null)[] } {
  return {
    where: `(${alias}.user_id = ? or (${alias}.household_id is not null and ${alias}.household_id = ?))`,
    params: [userId, householdOf(d, userId)],
  };
}

export interface HouseholdInfo {
  id: string;
  name: string;
  members: { login: string; me: boolean }[];
}

export function householdInfo(d: Database.Database, userId: string): HouseholdInfo | null {
  const hh = householdOf(d, userId);
  if (!hh) return null;
  const h = d.prepare('select id, name from households where id = ?').get(hh) as { id: string; name: string };
  const members = (
    d
      .prepare(
        `select u.id, u.login from household_members m join users u on u.id = m.user_id
         where m.household_id = ? order by m.joined_at`,
      )
      .all(hh) as { id: string; login: string }[]
  ).map((m) => ({ login: m.login, me: m.id === userId }));
  return { ...h, members };
}
