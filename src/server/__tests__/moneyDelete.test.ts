import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

// В тестах база — своя, а не файл приложения.
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
  current = d;
  return d;
}

function call(d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}, query = '') {
  return money({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;
}
const state = (d: Database.Database, userId: string, month = '2026-10') => call(d, userId, 'GET', ['state'], {}, `?month=${month}`) as Promise<MoneyState>;

beforeEach(() => {
  process.env.MONEY_USERS = 'me@example.com';
});

describe('удаление операции', () => {
  it('возвращает деньги на карту', async () => {
    const d = setup();
    await call(d, 'me', 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['RUB'] });
    const card = (await state(d, 'me')).accounts[0];
    await call(d, 'me', 'PATCH', ['accounts', card.id], { name: 'Карта', opening_minor: 1000000 });
    const op = await call(d, 'me', 'POST', ['ops'], {
      kind: 'expense',
      day: '2026-10-29',
      account_id: card.id,
      amount_minor: 334051,
      payee: 'Перекрёсток',
      items: [{ name: 'Пакет', qty: 1, total_minor: 4051, category_id: null }, { name: 'Сыр', qty: 1, total_minor: 330000 }],
    });
    expect((await state(d, 'me')).accounts.find((a) => a.id === card.id)?.balance_minor).toBe(1000000 - 334051);
    await call(d, 'me', 'DELETE', ['ops', op.id]);
    expect((await state(d, 'me')).accounts.find((a) => a.id === card.id)?.balance_minor).toBe(1000000);
  });

  it('позиции чека отдают свою категорию (для раскрытия категории в «Операциях»)', async () => {
    const d = setup();
    await call(d, 'me', 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['RUB'] });
    const s = await state(d, 'me');
    const cat = s.categories.find((c) => c.kind === 'expense')!;
    const card = s.accounts[0];
    await call(d, 'me', 'POST', ['ops'], {
      kind: 'expense',
      day: '2026-10-29',
      account_id: card.id,
      amount_minor: 10000,
      payee: 'Перекрёсток',
      items: [{ name: 'Хлеб', qty: 1, total_minor: 10000, category_id: cat.id }],
    });
    const ops = readOps(d, 'me', '2026-10-01', '2026-10-31');
    expect(ops[0].items).toEqual([{ name: 'Хлеб', total_minor: 10000, category_id: cat.id }]);
  });
});
