import { describe, expect, it } from 'vitest';
import { findProduct, formatQty, groupOf, match, mergeInto, normName, scaleQty } from '../kitchen';
import { SEED_PRODUCTS, SEED_RECIPES } from '../kitchenSeed';

const products = SEED_PRODUCTS.map((p) => ({ ...p, id: p.name, aliases: p.aliases ?? [], basic: !!p.basic }));
const byId = new Map(products.map((p) => [p.id, p]));

describe('продукты', () => {
  it('по названию и синонимам, без учёта регистра и «ё»', () => {
    expect(findProduct(products, 'Яйцо')?.name).toBe('яйца');
    expect(findProduct(products, ' макароны ')?.name).toBe('паста');
    expect(findProduct(products, 'свекла')?.name).toBe('свёкла');
    expect(findProduct(products, 'зелёный лук')?.name).toBe('зелёный лук');
    expect(findProduct(products, 'драконий фрукт')).toBeNull();
  });
  it('у каждого продукта уникальное имя и синонимы не пересекаются', () => {
    const all = products.flatMap((p) => [p.name, ...p.aliases].map(normName));
    expect(new Set(all).size).toBe(all.length);
  });
  it('в базовых рецептах все ингредиенты есть в справочнике', () => {
    for (const r of SEED_RECIPES) for (const [name] of r.ingredients) expect(findProduct(products, name), `${r.title}: ${name}`).not.toBeNull();
  });
});

describe('подбор блюд', () => {
  const omelet = { ingredients: [{ product_id: 'яйца', qty: 4, unit: 'шт.' }, { product_id: 'молоко', qty: 100, unit: 'мл' }, { product_id: 'соль', qty: null, unit: null }] };
  it('соль «всегда есть», остальное — из запасов', () => {
    expect(match(omelet, new Set(['яйца', 'молоко']), byId)).toEqual({ missing: [], total: 2, have: 2 });
    const m = match(omelet, new Set(['яйца']), byId);
    expect(m).toEqual({ missing: ['молоко'], total: 2, have: 1 });
    expect(groupOf(m)).toBe('almost');
  });
  it('не хватает трёх — «остальное»', () => {
    expect(groupOf({ missing: ['a', 'b', 'c'], total: 3, have: 0 })).toBe('rest');
  });
});

describe('количества', () => {
  it('пересчёт порций', () => {
    expect(scaleQty(300, 'г', 4 / 3)).toBe(400);
    expect(scaleQty(1, 'шт.', 1.5)).toBe(1.5);
    expect(scaleQty(3, 'шт.', 1 / 3)).toBe(1);
    expect(scaleQty(0.5, 'шт.', 0.5)).toBe(0.5);
    expect(scaleQty(null, null, 2)).toBeNull();
  });
  it('подписи', () => {
    expect(formatQty(200, 'мл')).toBe('200 мл');
    expect(formatQty(1.5, 'шт.')).toBe('1,5 шт.');
    expect(formatQty(2, 'зубчик')).toBe('2 зубчика');
    expect(formatQty(5, 'зубчик')).toBe('5 зубчиков');
    expect(formatQty(4, 'ломтик')).toBe('4 ломтика');
    expect(formatQty(1, 'стакан')).toBe('1 стакан');
    expect(formatQty(0.5, 'банка')).toBe('0,5 банки');
    expect(formatQty(null, null)).toBe('по вкусу');
  });
});

describe('слияние с покупками', () => {
  const list = [
    { id: 'm', product_id: 'молоко', qty: 500, unit: 'мл', done: false },
    { id: 'e', product_id: 'яйца', qty: 10, unit: 'шт.', done: true },
    { id: 's', product_id: 'сыр', qty: null, unit: null, done: false },
  ];
  it('та же единица — прибавляем', () => {
    expect(mergeInto(list, { product_id: 'молоко', qty: 200, unit: 'мл' })).toEqual({ kind: 'add', id: 'm', qty: 700, prev: 500 });
  });
  it('уже купленное — новый пункт', () => {
    expect(mergeInto(list, { product_id: 'яйца', qty: 2, unit: 'шт.' })).toEqual({ kind: 'create' });
  });
  it('без количества — не дублируем', () => {
    expect(mergeInto(list, { product_id: 'сыр', qty: 50, unit: 'г' })).toEqual({ kind: 'keep', id: 's' });
  });
  it('нового продукта нет — создаём', () => {
    expect(mergeInto(list, { product_id: 'хлеб', qty: 1, unit: 'шт.' })).toEqual({ kind: 'create' });
  });
});
