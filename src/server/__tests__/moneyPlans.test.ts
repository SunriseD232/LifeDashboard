import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { smsIncoming } = await import('../moneySms');
const { processRecurring } = await import('../moneyPlans');
const { resetRatesClock, setRatesTransport, moscowDay } = await import('../moneyRates');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  user.run('me', 'me@example.com');
  user.run('other', 'other@example.com');
  current = d;
  return d;
}

function call(d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}, query = '') {
  return money({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;
}
const state = (d: Database.Database, userId = 'me', month = moscowDay().slice(0, 7)) => call(d, userId, 'GET', ['state'], {}, `?month=${month}`) as Promise<MoneyState>;
const fail = (p: Promise<unknown>) => p.then(() => null, (e: { status: number; message: string }) => e);

beforeEach(() => {
  process.env.MONEY_USERS = '*';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
});

async function world(d: Database.Database) {
  await call(d, 'me', 'POST', ['onboard'], { base_currency: 'RUB', currencies: [] });
  const s = await state(d);
  return { card: s.accounts[0], cat: (n: string) => s.categories.find((c) => c.name === n)!.id };
}

describe('регулярные платежи', () => {
  it('«записывать сам»: пропущенные записываются при загрузке, дата сдвигается', async () => {
    const d = setup();
    const { card, cat } = await world(d);
    await call(d, 'me', 'POST', ['recurring'], { account_id: card.id, kind: 'expense', amount_minor: 29900, category_id: cat('Подписки'), payee: 'Spotify', unit: 'month', every: 1, next_day: '2026-08-31', mode: 'auto' });
    expect(processRecurring(d, 'me', '2026-10-30')).toBe(2);
    const r = d.prepare("select day, amount_minor, source, payee from money_ops order by day").all();
    expect(r).toEqual([
      { day: '2026-08-31', amount_minor: 29900, source: 'recurring', payee: 'Spotify' },
      { day: '2026-09-30', amount_minor: 29900, source: 'recurring', payee: 'Spotify' },
    ]);
    expect((d.prepare('select next_day from money_recurring').get() as { next_day: string }).next_day).toBe('2026-10-31');
    // Повторно — ничего нового.
    expect(processRecurring(d, 'me', '2026-10-30')).toBe(0);
  });

  it('«спросить»: ждёт, «Записать» и «Пропустить» сдвигают дату; поиск подписок', async () => {
    const d = setup();
    const { card, cat } = await world(d);
    const { id } = await call(d, 'me', 'POST', ['recurring'], { account_id: card.id, kind: 'expense', amount_minor: 75000, category_id: cat('Связь и интернет'), payee: 'Интернет', next_day: '2026-10-05' });
    expect(processRecurring(d, 'me', '2026-10-30')).toBe(0);
    await call(d, 'me', 'POST', ['recurring', id], { do: 'pay', amount_minor: 80000 });
    const op = d.prepare('select day, amount_minor from money_ops').get();
    expect(op).toEqual({ day: '2026-10-05', amount_minor: 80000 });
    await call(d, 'me', 'POST', ['recurring', id], { do: 'skip' });
    expect((d.prepare('select next_day from money_recurring').get() as { next_day: string }).next_day).toBe('2026-12-05');
    expect((await fail(call(d, 'other', 'POST', ['recurring', id], { do: 'pay' })))?.status).toBe(409);

    // Подписка в истории: три месяца подряд одно и то же.
    const today = moscowDay();
    const back = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
    for (const n of [90, 60, 30]) await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: back(n), account_id: card.id, amount_minor: 19900, payee: 'Яндекс Плюс' });
    const { suggestions } = await call(d, 'me', 'GET', ['recurring', 'suggest']);
    expect(suggestions.map((s: { payee: string }) => s.payee)).toEqual(['Яндекс Плюс']);
  });
});

describe('долги и цели', () => {
  it('дал в долг через счёт: остаток меньше, в тратах нет; возвраты закрывают долг', async () => {
    const d = setup();
    const { card } = await world(d);
    const day = moscowDay();
    const { id } = await call(d, 'me', 'POST', ['debts'], { direction: 'lent', person: 'Саша', amount_minor: 500000, day, account_id: card.id });
    let s = await state(d);
    expect(s.accounts[0].balance_minor).toBe(-500000);
    expect(s.month_parts).toEqual([]);
    expect(s.debts[0]).toMatchObject({ person: 'Саша', amount_minor: 500000, paid_minor: 0, currency: 'RUB', closed: false });
    await call(d, 'me', 'POST', ['debts', id], { do: 'pay', amount_minor: 200000, day, account_id: card.id });
    await call(d, 'me', 'POST', ['debts', id], { do: 'pay', amount_minor: 300000, day, account_id: card.id });
    s = await state(d);
    expect(s.accounts[0].balance_minor).toBe(0);
    expect(s.debts[0]).toMatchObject({ paid_minor: 500000, closed: true });
    const r = await call(d, 'me', 'GET', ['report'], {}, `?period=month&day=${day}&scope=all`);
    expect([r.spend, r.income]).toEqual([0, 0]);
    // Взял в долг без счёта — просто запись.
    await call(d, 'me', 'POST', ['debts'], { direction: 'borrowed', person: 'Мама', amount_minor: 1000000, currency: 'RUB', day, due_day: '2027-01-01' });
    expect((await state(d)).debts.find((x) => x.person === 'Мама')).toMatchObject({ direction: 'borrowed', due_day: '2027-01-01' });
    expect((await fail(call(d, 'other', 'POST', ['debts', id], { do: 'pay', amount_minor: 1, day, account_id: card.id })))?.status).toBe(409);
  });

  it('цели: со счётом и вручную', async () => {
    const d = setup();
    const { card } = await world(d);
    const { id } = await call(d, 'me', 'POST', ['goals'], { name: 'Отпуск', target_minor: 15000000, currency: 'RUB', due_day: '2027-06-01', saved_minor: 100000 });
    await call(d, 'me', 'PATCH', ['goals', id], { add_minor: 50000 });
    await call(d, 'me', 'POST', ['goals'], { name: 'Подушка', target_minor: 30000000, account_id: card.id });
    const s = await state(d);
    expect(s.goals.map((g) => [g.name, g.saved_minor, g.account_id])).toEqual([
      ['Отпуск', 150000, null],
      ['Подушка', 0, card.id],
    ]);
    await call(d, 'me', 'PATCH', ['goals', id], { archived: true });
    expect((await state(d)).goals).toHaveLength(1);
  });
});

describe('SMS от банка', () => {
  it('ключ → операция на счёт по цифрам карты; повтор и коды не записываются; импорт склеивает', async () => {
    const d = setup();
    const { card, cat } = await world(d);
    const other = await call(d, 'me', 'POST', ['accounts'], { name: 'Сбер', kind: 'card', currency: 'RUB', opening_minor: 0, card_last4: '1435' });
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-09-01', account_id: card.id, amount_minor: 100, payee: 'Perekrestok', category_id: cat('Продукты') });
    expect((await fail(call(d, 'me', 'PATCH', ['accounts', card.id], { card_last4: '12' })))?.status).toBe(400);

    const { token } = await call(d, 'me', 'POST', ['sms'], { account_id: card.id });
    expect(token).toMatch(/^ms_/);
    expect((await state(d)).sms_on).toBe(true);
    const pre = await call(d, 'me', 'POST', ['sms', 'preview'], { text: 'MIR-1435 20:16 Покупка 3340.51р PEREKRESTOK Баланс: 12345.67р' });
    expect(pre.op).toMatchObject({ kind: 'expense', amount_minor: 334051, account: 'Сбер', payee: 'Perekrestok', category_id: cat('Продукты') });

    const sms = 'MIR-1435 20:16 Покупка 3340.51р PEREKRESTOK Баланс: 12345.67р';
    const r = smsIncoming(d, `Bearer ${token}`, { text: sms });
    expect(r).toMatchObject({ ok: true, account: 'Сбер' });
    expect(smsIncoming(d, `Bearer ${token}`, { text: sms })).toMatchObject({ skipped: 'уже записано' });
    expect(smsIncoming(d, null, { token, text: 'Код: 1234. Никому не сообщайте' })).toMatchObject({ skipped: 'не похоже на операцию' });
    // Без цифр карты — на счёт по умолчанию.
    expect(smsIncoming(d, `Bearer ${token}`, { text: 'Покупка 350р KOFEMANIYA' })).toMatchObject({ account: card.name });
    expect(() => smsIncoming(d, 'Bearer ms_wrong', { text: sms })).toThrow(/Ключ не подходит/);
    expect(() => smsIncoming(d, null, { text: sms })).toThrow(/Нет ключа/);

    // Выписка Сбера потом — та же покупка склеивается с SMS, а не задваивается.
    const { rows } = await call(d, 'me', 'POST', ['import', 'check'], { account_id: other.id, rows: [{ key: 'h:x', day: moscowDay(), amount_minor: -334051 }] });
    expect(rows[0].status).toBe('link');
    await call(d, 'me', 'POST', ['import', 'commit'], { account_id: other.id, rows: [{ key: 'h:x', action: 'link', link_id: rows[0].op_id }] });
    expect((d.prepare('select import_key from money_ops where id = ?').get(rows[0].op_id) as { import_key: string }).import_key).toBe('h:x');

    // Новый ключ — старый больше не работает.
    await call(d, 'me', 'POST', ['sms'], {});
    expect(() => smsIncoming(d, `Bearer ${token}`, { text: sms })).toThrow(/Ключ не подходит/);
  });
});
