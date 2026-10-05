import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { checklists } from '../api/checklists';
import { items } from '../api/items';
import type { Ctx } from '../http';
import { readPantry, shoppingList } from '../kitchenStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x')").run();
  return d;
}

const ctx = (d: Database.Database, method: string, body: Record<string, unknown>, id: string, action?: string) =>
  ({ d, userId: 'me', method, body, id, action }) as unknown as Ctx;

describe('купил — значит есть дома', () => {
  it('вещь, добавленная в покупки через «Чек-листы», после отметки попадает домой', () => {
    const d = setup();
    const list = shoppingList(d, 'me', true)!;
    const { id } = checklists(ctx(d, 'POST', { title: 'Сметана' }, list.id, 'items')) as { id: string };
    expect((d.prepare('select product_id from checklist_items where id = ?').get(id) as { product_id: string | null }).product_id).not.toBeNull();
    items(ctx(d, 'PATCH', { done: true }, id));
    expect(readPantry(d, 'u:me')).toHaveLength(1);
  });
  it('старый пункт без продукта привязывается при отметке', () => {
    const d = setup();
    const list = shoppingList(d, 'me', true)!;
    d.prepare("insert into checklist_items (id, checklist_id, user_id, title) values ('old', ?, 'me', 'творог')").run(list.id);
    items(ctx(d, 'PATCH', { done: true }, 'old'));
    expect(readPantry(d, 'u:me')).toHaveLength(1);
  });
  it('обычный чек-лист продукты не заводит', () => {
    const d = setup();
    const { id: cid } = checklists(ctx(d, 'POST', { title: 'Бассейн' }, undefined as unknown as string)) as { id: string };
    const { id } = checklists(ctx(d, 'POST', { title: 'Плавки' }, cid, 'items')) as { id: string };
    items(ctx(d, 'PATCH', { done: true }, id));
    expect(readPantry(d, 'u:me')).toHaveLength(0);
  });
});
