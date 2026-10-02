import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { Ctx } from '../http';
import { search } from '../api/search';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'wife', 'stranger'].forEach((u) => user.run(u, u));
  d.prepare("insert into households (id, name, created_by) values ('h', 'Семья', 'me')").run();
  d.prepare("insert into household_members (user_id, household_id) values ('me', 'h'), ('wife', 'h')").run();
  d.prepare("insert into notes (id, user_id, title, body) values ('n1', 'me', 'Расписание бассейна', 'Вт, чт — 18:30')").run();
  d.prepare("insert into notes (id, user_id, household_id, title, body) values ('n2', 'wife', 'h', 'Ёлка на Новый год', 'купить игрушки')").run();
  d.prepare("insert into notes (id, user_id, title, body) values ('n3', 'stranger', 'Бассейн у соседа', '')").run();
  d.prepare("insert into checklists (id, user_id, title) values ('c1', 'me', 'Бассейн')").run();
  d.prepare("insert into checklist_items (id, checklist_id, user_id, title) values ('i1', 'c1', 'me', 'Плавки')").run();
  d.prepare("insert into tasks (id, user_id, title, tag) values ('t1', 'me', 'Продлить абонемент в бассейн', 'спорт')").run();
  return d;
}

const ask = (d: Database.Database, userId: string, q: string) =>
  (search({ d, userId, method: 'GET', body: {}, req: { nextUrl: new URL(`http://x/?q=${encodeURIComponent(q)}`) } } as unknown as Ctx) as {
    results: { kind: string; id: string; parent?: { id: string } }[];
  }).results;

describe('поиск', () => {
  it('находит по началу слова во всех разделах, только своё', () => {
    const r = ask(setup(), 'me', 'бассейн');
    expect(r.map((x) => x.id).sort()).toEqual(['c1', 'n1', 't1']);
  });
  it('пункт чек-листа знает свой чек-лист', () => {
    const r = ask(setup(), 'me', 'плавк');
    expect(r).toEqual([expect.objectContaining({ kind: 'item', id: 'i1', parent: { id: 'c1', title: 'Бассейн' } })]);
  });
  it('общая заметка семьи находится, «ё» = «е»', () => {
    expect(ask(setup(), 'me', 'елка').map((x) => x.id)).toEqual(['n2']);
  });
  it('индекс следует за правками и удалением', () => {
    const d = setup();
    d.prepare("update tasks set title = 'Купить очки' where id = 't1'").run();
    expect(ask(d, 'me', 'абонемент')).toEqual([]);
    expect(ask(d, 'me', 'очки').map((x) => x.id)).toEqual(['t1']);
    d.prepare("delete from checklists where id = 'c1'").run();
    expect(ask(d, 'me', 'плавки')).toEqual([]);
  });
});
