import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { resetRatesClock, setRatesTransport } = await import('../moneyRates');
import type { Ctx } from '../http';

const call = (method: string, path: string[], body: Record<string, unknown> = {}, query = '') =>
  money({ d: current, userId: 'me', method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;

beforeEach(() => {
  process.env.MONEY_USERS = '*';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
  current = new Database(':memory:');
  current.pragma('foreign_keys = ON');
  migrate(current);
  current.prepare("insert into users (id, login, password_hash) values ('me', 'me@x', 'x')").run();
});

describe('тот же чек второй раз', () => {
  it('спрашивает (409), с force — записывает; ручной ввод не трогает', async () => {
    await call('POST', ['onboard'], { base_currency: 'RUB', currencies: [] });
    const acc = (await call('GET', ['state'], {}, '?month=2026-09')).accounts[0];
    const receipt = { kind: 'expense', day: '2026-09-24', account_id: acc.id, amount_minor: 334051, payee: 'Перекрёсток', source: 'photo', items: [{ name: 'Пакет', total_minor: 334051 }] };
    await call('POST', ['ops'], receipt);
    const err = await call('POST', ['ops'], receipt).then(
      () => null,
      (e: { status: number; message: string }) => e,
    );
    expect(err?.status).toBe(409);
    expect(err?.message).toBe('Этот чек уже записан: Перекрёсток, 24 сентября.');
    await call('POST', ['ops'], { ...receipt, force: true });
    // Та же сумма вручную — не чек, не спрашиваем.
    await call('POST', ['ops'], { ...receipt, source: 'manual', items: [] });
    expect((await call('GET', ['state'], {}, '?month=2026-09')).ops).toHaveLength(3);
  });
});
