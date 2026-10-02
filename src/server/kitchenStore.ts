import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { findProduct, type Product, type Recipe } from '@/lib/kitchen';
import { guessDept, type Category } from '@/lib/kitchenSeed';
import { householdOf, visibleWhere } from './household';

/**
 * Кухня в базе. «Что есть дома» и список покупок — общие для семьи (scope —
 * id семьи), без семьи — свои ('u:' + id человека).
 */

export function scopeOf(d: Database.Database, userId: string): string {
  return householdOf(d, userId) ?? `u:${userId}`;
}

/** Область запасов для чек-листа покупок: его семья или его владелец. */
export function scopeOfList(list: { user_id: string; household_id: string | null }): string {
  return list.household_id ?? `u:${list.user_id}`;
}

export function readProducts(d: Database.Database): Product[] {
  return (d.prepare('select id, name, dept, aliases, basic from products order by name').all() as (Omit<Product, 'aliases' | 'basic'> & {
    aliases: string;
    basic: number;
  })[]).map((p) => ({ ...p, aliases: JSON.parse(p.aliases) as string[], basic: !!p.basic }));
}

/** Продукт по названию; нет такого — заводим в справочник (отдел угадываем по названию). */
export function productByName(d: Database.Database, userId: string, name: string): Product {
  const all = readProducts(d);
  const found = findProduct(all, name);
  if (found) return found;
  const p: Product = { id: randomUUID(), name: name.trim().toLowerCase().slice(0, 60), dept: guessDept(name), aliases: [], basic: false };
  d.prepare('insert into products (id, name, dept, aliases, basic, created_by) values (?, ?, ?, ?, 0, ?)').run(p.id, p.name, p.dept, '[]', userId);
  return p;
}

export function readPantry(d: Database.Database, scope: string): string[] {
  return (d.prepare('select product_id from pantry where scope = ? order by added_at').all(scope) as { product_id: string }[]).map(
    (r) => r.product_id,
  );
}

export function addToPantry(d: Database.Database, scope: string, productId: string): void {
  d.prepare('insert or ignore into pantry (scope, product_id) values (?, ?)').run(scope, productId);
}

export function readRecipes(d: Database.Database, userId: string): Recipe[] {
  const v = visibleWhere(d, userId, 'r');
  const rows = d
    .prepare(
      `select r.id, r.user_id, r.household_id, r.title, r.category, r.minutes, r.servings, r.steps, r.note, u.login as author
       from recipes r left join users u on u.id = r.user_id where ${v.where} order by r.title`,
    )
    .all(...v.params) as {
    id: string;
    user_id: string;
    household_id: string | null;
    title: string;
    category: Category;
    minutes: number | null;
    servings: number;
    steps: string;
    note: string | null;
    author: string;
  }[];
  if (!rows.length) return [];
  const ings = d
    .prepare(
      `select recipe_id, product_id, qty, unit from recipe_ingredients
       where recipe_id in (select value from json_each(?)) order by position`,
    )
    .all(JSON.stringify(rows.map((r) => r.id))) as { recipe_id: string; product_id: string; qty: number | null; unit: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    minutes: r.minutes,
    servings: r.servings,
    steps: JSON.parse(r.steps) as string[],
    note: r.note,
    household_id: r.household_id,
    author: r.user_id === userId ? null : r.author,
    ingredients: ings.filter((i) => i.recipe_id === r.id).map(({ product_id, qty, unit }) => ({ product_id, qty, unit })),
  }));
}

export function findRecipe(d: Database.Database, userId: string, id: unknown): { id: string; user_id: string; household_id: string | null } | null {
  if (typeof id !== 'string' || !id) return null;
  const v = visibleWhere(d, userId, 'r');
  return (d.prepare(`select r.id, r.user_id, r.household_id from recipes r where r.id = ? and ${v.where}`).get(id, ...v.params) as
    | { id: string; user_id: string; household_id: string | null }
    | undefined) ?? null;
}

/**
 * Список покупок человека: общий семьи, если он в семье, иначе свой.
 * Нет — заводим (create = true).
 */
export function shoppingList(d: Database.Database, userId: string, create: boolean): { id: string; user_id: string; household_id: string | null } | null {
  const hh = householdOf(d, userId);
  const found = (hh
    ? d.prepare("select id, user_id, household_id from checklists where kind = 'shopping' and household_id = ? limit 1").get(hh)
    : d.prepare("select id, user_id, household_id from checklists where kind = 'shopping' and user_id = ? and household_id is null limit 1").get(userId)) as
    | { id: string; user_id: string; household_id: string | null }
    | undefined;
  if (found || !create) return found ?? null;
  const id = randomUUID();
  const pos = ((d.prepare('select max(position) as m from checklists where user_id = ?').get(userId) as { m: number | null }).m ?? -1) + 1;
  d.prepare("insert into checklists (id, user_id, household_id, title, icon, position, kind) values (?, ?, ?, 'Покупки', 'bag', ?, 'shopping')").run(
    id,
    userId,
    hh,
    pos,
  );
  return { id, user_id: userId, household_id: hh };
}
