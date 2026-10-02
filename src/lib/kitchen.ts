import type { Category } from './kitchenSeed';

/**
 * Кухня без базы: продукты по названию, подбор блюд по запасам, пересчёт
 * порций и слияние с покупками. Одно и то же на сервере и на экране.
 */

export interface Product {
  id: string;
  name: string;
  dept: string;
  aliases: string[];
  /** «Всегда есть» — соль, вода… В подборе блюд не считается недостающим. */
  basic: boolean;
}

export interface Ingredient {
  product_id: string;
  qty: number | null;
  unit: string | null;
}

export interface Recipe {
  id: string;
  title: string;
  category: Category;
  minutes: number | null;
  servings: number;
  steps: string[];
  note: string | null;
  ingredients: Ingredient[];
  household_id: string | null;
  /** Кто завёл — для общих рецептов, если не я. */
  author: string | null;
}

/** Для сравнения названий: регистр, «ё», лишние пробелы. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Продукт по названию или синониму; null — такого нет. */
export function findProduct<P extends Pick<Product, 'name' | 'aliases'>>(products: P[], name: string): P | null {
  const n = normName(name);
  if (!n) return null;
  return products.find((p) => normName(p.name) === n || p.aliases.some((a) => normName(a) === n)) ?? null;
}

export interface Match {
  /** Чего не хватает (без «всегда есть»), по порядку ингредиентов. */
  missing: string[];
  /** Сколько ингредиентов считается (без «всегда есть»). */
  total: number;
  have: number;
}

/** Что из рецепта есть дома. */
export function match(recipe: Pick<Recipe, 'ingredients'>, pantry: ReadonlySet<string>, products: ReadonlyMap<string, Pick<Product, 'basic'>>): Match {
  const counted = recipe.ingredients.filter((i) => !products.get(i.product_id)?.basic);
  const missing = counted.filter((i) => !pantry.has(i.product_id)).map((i) => i.product_id);
  return { missing: [...new Set(missing)], total: counted.length, have: counted.length - new Set(missing).size };
}

export type Group = 'now' | 'almost' | 'rest';

/** Можно сейчас / не хватает 1–2 / остальное. */
export function groupOf(m: Match): Group {
  if (m.missing.length === 0) return 'now';
  if (m.missing.length <= 2) return 'almost';
  return 'rest';
}

/** Штучное округляем до половинок, граммы — до 5, остальное — до десятых. */
export function scaleQty(qty: number | null, unit: string | null, factor: number): number | null {
  if (qty === null) return null;
  const x = qty * factor;
  if (unit === 'г' || unit === 'мл') return x >= 50 ? Math.round(x / 5) * 5 : Math.round(x);
  if (unit === 'шт.' || unit === 'зубчик' || unit === 'ломтик' || unit === 'банка') return Math.max(0.5, Math.round(x * 2) / 2);
  return Math.round(x * 10) / 10;
}

/** Единицы-слова, которые склоняются: [1, 2–4, 5+]; дробное — как 2–4. */
const UNIT_FORMS: Record<string, [string, string, string]> = {
  зубчик: ['зубчик', 'зубчика', 'зубчиков'],
  ломтик: ['ломтик', 'ломтика', 'ломтиков'],
  стакан: ['стакан', 'стакана', 'стаканов'],
  банка: ['банка', 'банки', 'банок'],
  пучок: ['пучок', 'пучка', 'пучков'],
};

/** «200 мл», «1,5 шт.», «4 ломтика», «по вкусу». */
export function formatQty(qty: number | null, unit: string | null): string {
  if (qty === null) return 'по вкусу';
  const n = Number.isInteger(qty) ? String(qty) : String(qty).replace('.', ',');
  if (!unit) return n;
  const forms = UNIT_FORMS[unit];
  if (forms) {
    if (!Number.isInteger(qty)) return `${n} ${forms[1]}`;
    const a = qty % 10;
    const b = qty % 100;
    return `${n} ${a === 1 && b !== 11 ? forms[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? forms[1] : forms[2]}`;
  }
  return `${n} ${unit}`;
}

export interface ShoppingItem {
  id: string;
  product_id: string | null;
  qty: number | null;
  unit: string | null;
  done: boolean;
}

/**
 * Куда положить продукт в покупках: в уже купленный пункт не дописываем —
 * заводим новый; в некупленный с той же единицей — прибавляем количество; с
 * другой единицей или «по вкусу» — не трогаем количество, просто не дублируем.
 */
export function mergeInto(
  list: ShoppingItem[],
  add: Pick<ShoppingItem, 'product_id' | 'qty' | 'unit'>,
): { kind: 'create' } | { kind: 'add'; id: string; qty: number | null; prev: number | null } | { kind: 'keep'; id: string } {
  const same = list.find((i) => !i.done && i.product_id && i.product_id === add.product_id);
  if (!same) return { kind: 'create' };
  if (same.qty !== null && add.qty !== null && same.unit === add.unit) {
    return { kind: 'add', id: same.id, qty: Math.round((same.qty + add.qty) * 100) / 100, prev: same.qty };
  }
  return { kind: 'keep', id: same.id };
}
