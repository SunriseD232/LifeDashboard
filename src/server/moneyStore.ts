import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CATEGORIES, type MoneyAccount, type MoneyCategory, type MoneyOp, type MoneySettings } from '@/lib/money';
import { householdOf } from './household';

/**
 * Чтение «Денег» из базы. Видно человеку: свои счета и семейные счета его
 * семьи; операция видна, если виден её счёт (или счёт, куда ушли деньги).
 */

/**
 * Кому открыт раздел, пока он тестовый: логины или id из MONEY_USERS через
 * запятую в .env; «*» — всем.
 */
export function moneyAllowed(userId: string, login: string | null): boolean {
  const list = (process.env.MONEY_USERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes('*') || list.includes(userId.toLowerCase()) || (!!login && list.includes(login.toLowerCase()));
}

export function readMoneySettings(d: Database.Database, userId: string): MoneySettings | null {
  const row = d.prepare('select base_currency, currencies, hidden from money_settings where user_id = ?').get(userId) as
    | { base_currency: string; currencies: string; hidden: string }
    | undefined;
  return row ? { base_currency: row.base_currency, currencies: JSON.parse(row.currencies), hidden: JSON.parse(row.hidden) } : null;
}

/** Условие «счёт виден» для псевдонима alias и параметры к нему. */
function accountVisible(d: Database.Database, userId: string, alias: string) {
  return {
    where: `(${alias}.user_id = ? or (${alias}.household_id is not null and ${alias}.household_id = ?))`,
    params: [userId, householdOf(d, userId)],
  };
}

interface AccountRow {
  id: string;
  user_id: string;
  household_id: string | null;
  name: string;
  kind: MoneyAccount['kind'];
  currency: string;
  opening_minor: number;
  archived: number;
  position: number;
  author: string | null;
  balance_minor: number;
}

export function readAccounts(d: Database.Database, userId: string): MoneyAccount[] {
  const v = accountVisible(d, userId, 'a');
  const rows = d
    .prepare(
      `select a.*, u.login as author,
         a.opening_minor
         + coalesce((select sum(case when o.kind = 'income' then o.amount_minor else -o.amount_minor end) from money_ops o where o.account_id = a.id), 0)
         + coalesce((select sum(o.to_amount_minor) from money_ops o where o.to_account_id = a.id and o.kind in ('transfer', 'exchange')), 0)
         as balance_minor
       from money_accounts a left join users u on u.id = a.user_id
       where ${v.where}
       order by a.archived, a.position, a.created_at`,
    )
    .all(...v.params) as AccountRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    currency: r.currency,
    opening_minor: r.opening_minor,
    archived: !!r.archived,
    position: r.position,
    shared: !!r.household_id,
    mine: r.user_id === userId,
    author: r.user_id === userId ? null : r.author,
    balance_minor: r.balance_minor,
  }));
}

/** Свой или семейный счёт — или undefined, если не виден. */
export function visibleAccount(d: Database.Database, userId: string, id: unknown) {
  if (typeof id !== 'string') return undefined;
  const v = accountVisible(d, userId, 'a');
  return d.prepare(`select a.* from money_accounts a where a.id = ? and ${v.where}`).get(id, ...v.params) as
    | { id: string; user_id: string; household_id: string | null; currency: string; name: string }
    | undefined;
}

export function readCategories(d: Database.Database, userId: string): MoneyCategory[] {
  return d
    .prepare('select id, kind, name, position from money_categories where user_id = ? and archived = 0 order by kind, position, name')
    .all(userId) as MoneyCategory[];
}

export function seedCategories(d: Database.Database, userId: string) {
  if (d.prepare('select 1 from money_categories where user_id = ? limit 1').get(userId)) return;
  const add = d.prepare('insert into money_categories (id, user_id, kind, name, position) values (?, ?, ?, ?, ?)');
  for (const g of DEFAULT_CATEGORIES) g.names.forEach((name, i) => add.run(randomUUID(), userId, g.kind, name, i));
}

interface OpRow extends Omit<MoneyOp, 'mine' | 'author'> {
  user_id: string;
  author: string | null;
}

/** Операции за период [from, to] (дни YYYY-MM-DD), новые сверху. */
export function readOps(d: Database.Database, userId: string, from: string, to: string): MoneyOp[] {
  const a = accountVisible(d, userId, 'a');
  const b = accountVisible(d, userId, 'b');
  const rows = d
    .prepare(
      `select o.id, o.user_id, o.kind, o.day, o.account_id, o.amount_minor, o.currency, o.to_account_id, o.to_amount_minor,
         o.to_currency, o.orig_amount_minor, o.orig_currency, o.category_id, c.name as category_name, o.payee, o.note, o.source,
         u.login as author, (select count(*) from money_items i where i.op_id = o.id) as items_count
       from money_ops o
         join money_accounts a on a.id = o.account_id
         left join money_accounts b on b.id = o.to_account_id
         left join money_categories c on c.id = o.category_id
         left join users u on u.id = o.user_id
       where o.day between ? and ? and (${a.where} or (b.id is not null and ${b.where}))
       order by o.day desc, o.created_at desc`,
    )
    .all(from, to, ...a.params, ...b.params) as OpRow[];
  return rows.map(({ user_id, author, ...r }) => ({ ...r, mine: user_id === userId, author: user_id === userId ? null : author }));
}

/** Операция, которую человек видит, — или undefined. */
export function visibleOp(d: Database.Database, userId: string, id: unknown) {
  if (typeof id !== 'string') return undefined;
  const a = accountVisible(d, userId, 'a');
  const b = accountVisible(d, userId, 'b');
  return d
    .prepare(
      `select o.* from money_ops o join money_accounts a on a.id = o.account_id left join money_accounts b on b.id = o.to_account_id
       where o.id = ? and (${a.where} or (b.id is not null and ${b.where}))`,
    )
    .get(id, ...a.params, ...b.params) as { id: string; user_id: string; account_id: string; kind: string; category_id: string | null } | undefined;
}

export interface MoneyItem {
  id: string;
  position: number;
  name: string;
  norm_name: string | null;
  qty: number;
  unit: string | null;
  price_minor: number | null;
  total_minor: number;
  category_id: string | null;
}

export function readItems(d: Database.Database, opId: string): MoneyItem[] {
  return d
    .prepare('select id, position, name, norm_name, qty, unit, price_minor, total_minor, category_id from money_items where op_id = ? order by position')
    .all(opId) as MoneyItem[];
}

export function readUserRates(d: Database.Database, userId: string): Record<string, number> {
  const rows = d.prepare('select currency, rate from money_user_rates where user_id = ?').all(userId) as { currency: string; rate: number }[];
  return Object.fromEntries(rows.map((r) => [r.currency, r.rate]));
}
