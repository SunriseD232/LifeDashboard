import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { readOps } = await import('../moneyStore');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')").run('me', 'me@example.com');
  d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')").run('other', 'other@example.com');
  current = d;
  return d;
}

function call(d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}, query = '') {
  return money({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;
}
const state = (d: Database.Database, userId: string) => call(d, userId, 'GET', ['state'], {}, '?month=2026-10') as Promise<MoneyState>;

beforeEach(() => {
  process.env.MONEY_USERS = '*';
});

async function start(d: Database.Database) {
  await call(d, 'me', 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['RUB'] });
  const s = await state(d, 'me');
  const card = s.accounts[0];
  await call(d, 'me', 'PATCH', ['accounts', card.id], { name: 'Карта', opening_minor: 1000000 });
  return { card, cat: s.categories.find((c) => c.kind === 'expense')! };
}
const add = (d: Database.Database, body: Record<string, unknown>) => call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-10-29', ...body }) as Promise<{ id: string }>;
const balance = async (d: Database.Database, id: string) => (await state(d, 'me')).accounts.find((a) => a.id === id)!.balance_minor;

describe('соединить операции', () => {
  it('сложить: сумма, позиции обеих, остальные удалены, остаток тот же', async () => {
    const d = setup();
    const { card, cat } = await start(d);
    const a = await add(d, { account_id: card.id, amount_minor: 30000, payee: 'Пятёрочка', items: [{ name: 'Хлеб', total_minor: 30000 }] });
    const b = await add(d, { account_id: card.id, amount_minor: 12000, category_id: cat.id, note: 'вторая карта не прошла', items: [{ name: 'Сыр', total_minor: 12000 }] });
    const before = await balance(d, card.id);
    await call(d, 'me', 'POST', ['ops', 'merge'], { ids: [a.id, b.id], main: a.id, mode: 'sum' });
    const ops = readOps(d, 'me', '2026-10-01', '2026-10-31');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ id: a.id, amount_minor: 42000, payee: 'Пятёрочка', category_id: cat.id, note: 'вторая карта не прошла', items_count: 2 });
    expect(ops[0].items?.map((i) => i.name)).toEqual(['Хлеб', 'Сыр']);
    expect(await balance(d, card.id)).toBe(before);
  });

  it('одна покупка дважды (SMS и чек): сумма одна, позиции чека, деньги вернулись', async () => {
    const d = setup();
    const { card } = await start(d);
    const sms = await add(d, { account_id: card.id, amount_minor: 54900, payee: 'PEREKRESTOK', source: 'sms' });
    const photo = await add(d, { account_id: card.id, amount_minor: 54900, payee: 'Перекрёсток', source: 'photo', items: [{ name: 'Молоко', total_minor: 54900 }] });
    const before = await balance(d, card.id);
    await call(d, 'me', 'POST', ['ops', 'merge'], { ids: [sms.id, photo.id], main: photo.id, mode: 'same' });
    const ops = readOps(d, 'me', '2026-10-01', '2026-10-31');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ id: photo.id, amount_minor: 54900, payee: 'Перекрёсток', items_count: 1 });
    expect(await balance(d, card.id)).toBe(before + 54900);
  });

  it('одна покупка: позиции берутся у второй, если у оставленной их нет', async () => {
    const d = setup();
    const { card } = await start(d);
    const sms = await add(d, { account_id: card.id, amount_minor: 1000, source: 'sms' });
    const photo = await add(d, { account_id: card.id, amount_minor: 1000, payee: 'Ларёк', items: [{ name: 'Вода', total_minor: 1000 }] });
    await call(d, 'me', 'POST', ['ops', 'merge'], { ids: [sms.id, photo.id], main: sms.id, mode: 'same' });
    const ops = readOps(d, 'me', '2026-10-01', '2026-10-31');
    expect(ops).toMatchObject([{ id: sms.id, payee: 'Ларёк', items_count: 1 }]);
  });

  it('не даёт соединить разное и чужое', async () => {
    const d = setup();
    const { card } = await start(d);
    const a = await add(d, { account_id: card.id, amount_minor: 1000 });
    const b = await add(d, { account_id: card.id, amount_minor: 2000 });
    const inc = await call(d, 'me', 'POST', ['ops'], { kind: 'income', day: '2026-10-29', account_id: card.id, amount_minor: 500 });
    await expect(call(d, 'me', 'POST', ['ops', 'merge'], { ids: [a.id], main: a.id })).rejects.toThrow(/двух/);
    await expect(call(d, 'me', 'POST', ['ops', 'merge'], { ids: [a.id, inc.id], main: a.id })).rejects.toThrow(/траты с тратами/);
    await expect(call(d, 'me', 'POST', ['ops', 'merge'], { ids: [a.id, b.id], main: a.id, mode: 'same' })).rejects.toThrow(/Суммы разные/);
    await call(d, 'other', 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['RUB'] });
    await expect(call(d, 'other', 'POST', ['ops', 'merge'], { ids: [a.id, b.id], main: a.id })).rejects.toThrow(/не найдена/);
    expect(readOps(d, 'me', '2026-10-01', '2026-10-31')).toHaveLength(3);
  });
});
