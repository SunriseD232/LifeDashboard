import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { SEED_RECIPES } from '@/lib/kitchenSeed';
import { items } from '../api/items';
import { kitchen } from '../api/kitchen';
import { search } from '../api/search';
import type { Ctx } from '../http';
import { readItems } from '../checklistStore';
import { readPantry, readProducts, readRecipes, scopeOf, shoppingList } from '../kitchenStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'wife', 'stranger'].forEach((u) => user.run(u, u));
  d.prepare("insert into households (id, name, created_by) values ('h', 'Семья', 'me')").run();
  d.prepare("insert into household_members (user_id, household_id) values ('me', 'h'), ('wife', 'h')").run();
  return d;
}

const call = (fn: (c: Ctx) => unknown, d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}, q = '') =>
  fn({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/?${q}`) } } as unknown as Ctx) as never;

const pid = (d: Database.Database, name: string) => readProducts(d).find((p) => p.name === name)!.id;

describe('кухня', () => {
  it('базовые рецепты — один раз и общие для семьи', () => {
    const d = setup();
    expect(call(kitchen, d, 'me', 'POST', ['seed'])).toEqual({ added: SEED_RECIPES.length });
    expect(readRecipes(d, 'wife')).toHaveLength(SEED_RECIPES.length);
    expect(readRecipes(d, 'stranger')).toHaveLength(0);
    expect(() => call(kitchen, d, 'wife', 'POST', ['seed'])).toThrow(/уже есть/);
  });

  it('в покупки: новые пункты по отделам, повтор — прибавляет, «отменить» возвращает', () => {
    const d = setup();
    const milk = pid(d, 'молоко');
    const r1 = call(kitchen, d, 'me', 'POST', ['shopping'], { items: [{ product_id: milk, qty: 500, unit: 'мл', recipe: 'Блины' }, { name: 'Яйцо', qty: 2, unit: 'шт.' }] }) as {
      added: { id: string; created: boolean }[];
    };
    expect(r1.added.every((a) => a.created)).toBe(true);
    const list = readItems(d, 'me');
    expect(list.map((i) => [i.title, i.group_name, i.note])).toEqual([
      ['молоко', 'Молочное и яйца', '500 мл · блины'],
      ['яйца', 'Молочное и яйца', '2 шт.'],
    ]);
    const r2 = call(kitchen, d, 'me', 'POST', ['shopping'], { items: [{ product_id: milk, qty: 200, unit: 'мл' }] }) as { added: unknown[] };
    expect(readItems(d, 'me').find((i) => i.product_id === milk)?.qty).toBe(700);
    call(kitchen, d, 'me', 'POST', ['shopping', 'undo'], { added: r2.added });
    expect(readItems(d, 'me').find((i) => i.product_id === milk)?.qty).toBe(500);
    call(kitchen, d, 'me', 'POST', ['shopping', 'undo'], { added: r1.added });
    expect(readItems(d, 'me')).toHaveLength(0);
  });

  it('список покупок и запасы — общие: купила жена — дома есть у обоих', () => {
    const d = setup();
    call(kitchen, d, 'me', 'POST', ['shopping'], { items: [{ name: 'сливки', qty: 200, unit: 'мл' }] });
    expect(shoppingList(d, 'wife', false)?.id).toBe(shoppingList(d, 'me', false)?.id);
    const item = readItems(d, 'wife').find((i) => i.title === 'сливки')!;
    call(items, d, 'wife', 'PATCH', [item.id], { done: true });
    expect(readPantry(d, scopeOf(d, 'me'))).toEqual([pid(d, 'сливки')]);
    expect(readItems(d, 'stranger')).toHaveLength(0);
  });

  it('новый продукт по названию попадает в справочник, «ё» = «е»', () => {
    const d = setup();
    call(kitchen, d, 'me', 'POST', ['pantry'], { name: 'Свекла' });
    expect(readPantry(d, scopeOf(d, 'me'))).toEqual([pid(d, 'свёкла')]);
    const r = call(kitchen, d, 'me', 'POST', ['pantry'], { name: 'Кокосовое молоко' }) as { product: { dept: string } };
    expect(r.product.dept).toBe('Другое');
  });

  it('рецепт находится по ингредиенту', () => {
    const d = setup();
    call(kitchen, d, 'me', 'POST', ['seed']);
    const found = (call(search, d, 'wife', 'GET', [], {}, 'q=творог') as { results: { kind: string }[] }).results;
    expect(found.filter((x) => x.kind === 'recipe').length).toBeGreaterThanOrEqual(2);
  });

  it('свой рецепт: ингредиенты по названиям, правка пересобирает поиск', () => {
    const d = setup();
    const r = call(kitchen, d, 'me', 'POST', ['recipes'], {
      title: 'Гренки',
      category: 'breakfast',
      servings: 2,
      minutes: 10,
      steps: ['Обжарить'],
      ingredients: [{ name: 'хлеб', qty: 4, unit: 'ломтик' }, { name: 'яйца', qty: 2, unit: 'шт.' }],
    }) as { id: string };
    expect(readRecipes(d, 'me')[0].ingredients).toHaveLength(2);
    call(kitchen, d, 'me', 'PATCH', ['recipes', r.id], { ingredients: [{ name: 'хлеб', qty: 4, unit: 'ломтик' }, { name: 'молоко', qty: 100, unit: 'мл' }] });
    const q = (s: string) => (call(search, d, 'me', 'GET', [], {}, `q=${s}`) as { results: unknown[] }).results.length;
    expect(q('молоко')).toBe(1);
    expect(q('яйца')).toBe(0);
  });
});
