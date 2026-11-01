import type Database from 'better-sqlite3';
import { HttpError } from './http';

/**
 * Семья — несколько пользователей с общими делами, напоминаниями, покупками
 * и запасами. Человек состоит не больше чем в одной семье; общая строка
 * помечена household_id и видна всем участникам. Вступают только по
 * приглашению (household_invites), принимает его сам приглашённый.
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

/** Приглашение живёт две недели. */
export const INVITE_DAYS = 14;
const FRESH = `created_at >= datetime('now', '-${INVITE_DAYS} day')`;

export interface HouseholdInfo {
  id: string;
  name: string;
  members: { login: string; me: boolean }[];
  /** Кого позвали, а он ещё не ответил — логины, как их набрали. */
  invited: { id: string; login: string }[];
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
  const invited = d.prepare(`select id, login from household_invites where household_id = ? and ${FRESH} order by created_at`).all(hh) as {
    id: string;
    login: string;
  }[];
  return { ...h, members, invited };
}

export interface IncomingInvite {
  id: string;
  family: string;
  from: string;
}

/** Приглашения мне: по моему логину, свежие, не в мою же семью. */
export function invitesFor(d: Database.Database, userId: string): IncomingInvite[] {
  return d
    .prepare(
      `select i.id, h.name as family, u.login as "from" from household_invites i
       join households h on h.id = i.household_id join users u on u.id = i.invited_by
       join users me on me.id = ? and me.login = i.login
       where i.${FRESH} and i.household_id is not (select household_id from household_members where user_id = me.id)
       order by i.created_at desc`,
    )
    .all(userId) as IncomingInvite[];
}

/** Участники семьи: id и логин — для «кто делает» и рассылки событий. */
export function membersOf(d: Database.Database, hh: string): { id: string; login: string }[] {
  return d
    .prepare('select u.id, u.login from household_members m join users u on u.id = m.user_id where m.household_id = ? order by m.joined_at')
    .all(hh) as { id: string; login: string }[];
}

/**
 * Вступил в семью: его «что есть дома», холодильник и известное КБЖУ
 * сливаются с семейными — дальше у них одна кухня.
 */
export function mergeKitchenIn(d: Database.Database, userId: string, hh: string): void {
  const own = `u:${userId}`;
  d.prepare('insert or ignore into pantry (scope, product_id) select ?, product_id from pantry where scope = ?').run(hh, own);
  d.prepare('delete from pantry where scope = ?').run(own);
  d.prepare('update fridge_items set scope = ? where scope = ?').run(hh, own);
  d.prepare(
    `insert or ignore into fridge_nutrition (scope, key, kcal, protein, fat, carbs, source, confidence, note, updated_at)
     select ?, key, kcal, protein, fat, carbs, source, confidence, note, updated_at from fridge_nutrition where scope = ?`,
  ).run(hh, own);
  d.prepare('delete from fridge_nutrition where scope = ?').run(own);
}

/**
 * Человек уходит из семьи (сам или его убрали). Запасы и знание о КБЖУ
 * уходят с ним копией — дома у него те же продукты; последний забирает
 * и холодильник. Назначенное ему в семье снова «для всех».
 * Зовётся ДО удаления из household_members.
 */
export function leaveHousehold(d: Database.Database, userId: string, hh: string): void {
  const own = `u:${userId}`;
  d.prepare('insert or ignore into pantry (scope, product_id) select ?, product_id from pantry where scope = ?').run(own, hh);
  d.prepare(
    `insert or ignore into fridge_nutrition (scope, key, kcal, protein, fat, carbs, source, confidence, note, updated_at)
     select ?, key, kcal, protein, fat, carbs, source, confidence, note, updated_at from fridge_nutrition where scope = ?`,
  ).run(own, hh);
  d.prepare('update tasks set assignee_id = null where household_id = ? and assignee_id = ?').run(hh, userId);
  d.prepare('update reminders set assignee_id = null where household_id = ? and assignee_id = ?').run(hh, userId);
  d.prepare('delete from household_members where user_id = ?').run(userId);
  const left = d.prepare('select count(*) as n from household_members where household_id = ?').get(hh) as { n: number };
  if (left.n > 0) return;
  // Последний: холодильник — ему, семейные копии запасов больше не нужны.
  d.prepare('update fridge_items set scope = ? where scope = ?').run(own, hh);
  d.prepare('delete from pantry where scope = ?').run(hh);
  d.prepare('delete from fridge_nutrition where scope = ?').run(hh);
  d.prepare('delete from households where id = ?').run(hh);
}

/**
 * «Кто делает» из тела запроса: логин участника семьи или пусто — все.
 * Не в семье или не общее — никого.
 */
export function assigneeOf(d: Database.Database, hh: string | null, login: unknown): string | null {
  if (!hh || typeof login !== 'string' || !login.trim()) return null;
  const u = membersOf(d, hh).find((m) => m.login === login.trim().toLowerCase());
  if (!u) throw new HttpError(400, 'Поручить можно только человеку из семьи.');
  return u.id;
}
