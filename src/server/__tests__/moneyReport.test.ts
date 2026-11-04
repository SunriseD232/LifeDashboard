import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { setAiTransport } = await import('../ai');
const { resetRatesClock, setRatesTransport, saveRates } = await import('../moneyRates');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  user.run('me', 'me@example.com');
  user.run('wife', 'wife@example.com');
  current = d;
  return d;
}

function call(d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}, query = '') {
  return money({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;
}
const state = (d: Database.Database, userId: string, month = '2026-10') => call(d, userId, 'GET', ['state'], {}, `?month=${month}`) as Promise<MoneyState>;
const fail = (p: Promise<unknown>) => p.then(() => null, (e: { status: number; message: string }) => e);

let asked: { system: string; user: unknown }[] = [];
beforeEach(() => {
  process.env.MONEY_USERS = '*';
  process.env.AI_DAILY_LIMIT = '50';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
  asked = [];
  setAiTransport(async (req) => {
    asked.push(req as never);
    return '{"answer":"На кафе ушло 1 500 RUB."}';
  });
});
afterEach(() => setAiTransport(null));

async function world(d: Database.Database) {
  await call(d, 'me', 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['USD'] });
  const s = await state(d, 'me');
  const card = s.accounts[0];
  const usd = await call(d, 'me', 'POST', ['accounts'], { name: 'USD', kind: 'card', currency: 'USD', opening_minor: 0 });
  const cat = (name: string) => s.categories.find((c) => c.name === name)!.id;
  // Курс доллара менялся: 80 в сентябре, 90 с 15 октября.
  saveRates(d, { day: '2026-09-01', rates: { USD: 80 } });
  saveRates(d, { day: '2026-10-15', rates: { USD: 90 } });
  const op = (body: Record<string, unknown>) => call(d, 'me', 'POST', ['ops'], { kind: 'expense', account_id: card.id, ...body });
  await op({ day: '2026-09-10', amount_minor: 100000, category_id: cat('Кафе'), payee: 'Кофемания' });
  await op({ day: '2026-10-05', amount_minor: 50000, category_id: cat('Кафе'), payee: 'Кофемания' });
  await op({ day: '2026-10-20', account_id: usd.id, amount_minor: 1000, category_id: cat('Транспорт'), payee: 'Uber' });
  // Чек: продукты и бытовая химия в одной операции.
  await op({
    day: '2026-10-25',
    amount_minor: 147760,
    category_id: cat('Продукты'),
    payee: 'Пятёрочка',
    items: [
      { name: 'Молоко 2,5%', qty: 2, price_minor: 8990, total_minor: 17980, category_id: cat('Продукты') },
      { name: 'Средство для посуды', total_minor: 30890, category_id: cat('Бытовая химия') },
      { name: 'Сыр', total_minor: 98890 },
    ],
  });
  await op({ day: '2026-05-25', amount_minor: 7620, payee: 'Пятёрочка', items: [{ name: 'Молоко 2,5%', qty: 1, price_minor: 7620, total_minor: 7620 }] });
  await call(d, 'me', 'POST', ['ops'], { kind: 'income', account_id: card.id, day: '2026-10-01', amount_minor: 12000000, category_id: s.categories.find((c) => c.name === 'Зарплата')!.id });
  return { card, usd, cat };
}

describe('отчёты', () => {
  it('месяц: сравнение, курс на день операции, чек по категориям позиций, столбики', async () => {
    const d = setup();
    const { cat } = await world(d);
    const r = await call(d, 'me', 'GET', ['report'], {}, '?period=month&day=2026-10-30&scope=all');
    expect(r).toMatchObject({ title: 'Октябрь 2026', from: '2026-10-01', to: '2026-10-31', income: 12000000, prev_spend: 100000, missing_rates: [] });
    // 500 + $10 по 90 + чек 1 477,60
    expect(r.spend).toBe(50000 + 90000 + 147760);
    const byName = Object.fromEntries(r.categories.map((c: { name: string; spend: number; prev: number }) => [c.name, [c.spend, c.prev]]));
    expect(byName['Бытовая химия']).toEqual([30890, 0]);
    expect(byName['Продукты']).toEqual([17980 + 98890, 0]);
    expect(byName['Кафе']).toEqual([50000, 100000]);
    expect(r.categories[0].id).toBe(cat('Продукты'));
    expect(r.bars.map((b: { short: string }) => b.short)).toEqual(['май', 'июн', 'июл', 'авг', 'сен', 'окт']);
    expect(r.bars[0].spend).toBe(7620);
    expect(r.payees[0]).toEqual({ name: 'Пятёрочка', spend: 147760, count: 1 });

    const w = await call(d, 'me', 'GET', ['report'], {}, '?period=week&day=2026-10-20&scope=all');
    expect(w).toMatchObject({ from: '2026-10-19', spend: 90000 + 147760 });
    expect((await fail(call(d, 'me', 'GET', ['report'], {}, '?period=month&day=oops')))?.status).toBe(400);
  });

  it('бюджеты и траты месяца для главной', async () => {
    const d = setup();
    const { cat } = await world(d);
    await call(d, 'me', 'PUT', ['budgets'], { category_id: cat('Кафе'), limit_minor: 120000 });
    await call(d, 'me', 'PUT', ['budgets'], { category_id: cat('Продукты'), limit_minor: 500000 });
    await call(d, 'me', 'PUT', ['budgets'], { category_id: cat('Продукты'), limit_minor: null });
    expect((await fail(call(d, 'me', 'PUT', ['budgets'], { category_id: 'nope', limit_minor: 1 })))?.status).toBe(400);
    const s = await state(d, 'me');
    expect(s.budgets).toEqual([{ category_id: cat('Кафе'), limit_minor: 120000 }]);
    expect(s.month_parts.reduce((x, p) => x + p.base_minor, 0)).toBe(50000 + 90000 + 147760);
    expect(s.month_parts.filter((p) => p.category_id === cat('Бытовая химия'))).toHaveLength(1);
    expect(s.prev_spend).toEqual({ mine: 100000, family: 0 });
    // Чужие бюджеты не видны.
    await call(d, 'wife', 'POST', ['onboard'], { base_currency: 'RUB', currencies: [] });
    expect((await state(d, 'wife')).budgets).toEqual([]);
  });

  it('цены товаров из чеков и история', async () => {
    const d = setup();
    await world(d);
    const { items } = await call(d, 'me', 'GET', ['prices'], {}, '?q=молоко');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Молоко 2,5%', count: 2, first: { price: 7620 }, last: { price: 8990, payee: 'Пятёрочка' }, change: 18 });
    const { history } = await call(d, 'me', 'GET', ['prices'], {}, `?key=${encodeURIComponent(items[0].key)}`);
    expect(history.map((h: { day: string }) => h.day)).toEqual(['2026-05-25', '2026-10-25']);
    expect((await call(d, 'wife', 'GET', ['prices'], {}, '?q=').catch((e: { status: number }) => e)).status).toBe(409);
  });

  it('вопрос ИИ: данные за год в подсказке, ответ текстом', async () => {
    const d = setup();
    await world(d);
    const r = await call(d, 'me', 'POST', ['ask'], { question: 'Сколько ушло на кафе?', today: '2026-10-30' });
    expect(r).toEqual({ answer: 'На кафе ушло 1 500 RUB.' });
    const sys = asked[0].system.replace(/[  ]/g, ' ');
    expect(sys).toContain('Октябрь 2026: траты 2 877,60 RUB, доходы 120 000 RUB; Продукты 1 168,70 RUB');
    expect(sys).toContain('Сентябрь 2026: траты 1 000 RUB');
    expect(sys).toContain('Молоко 2,5% 76,20 → 89,90 RUB (+18%)');
    // Отдельные операции — для вопросов про день и покупку.
    expect(sys).toContain('Сегодня (2026-10-30): трат и доходов нет.');
    expect(sys).toContain('2026-10-20 −10 USD Uber, категория Транспорт');
    expect(sys).toContain('2026-10-05 −500 RUB Кофемания, категория Кафе');
    expect(asked[0].user).toBe('Сколько ушло на кафе?');
    expect((await fail(call(d, 'me', 'POST', ['ask'], { question: '' })))?.status).toBe(400);
  });

  it('строка ввода: один запрос — ИИ сам выбирает, записать или ответить', async () => {
    const d = setup();
    await world(d);
    // Вопрос — ответ по данным, в подсказке и правила записи, и данные.
    setAiTransport(async (req) => {
      asked.push(req as never);
      return '{"result":"question","answer":"Сегодня трат нет."}';
    });
    expect(await call(d, 'me', 'POST', ['ai', 'say'], { text: 'сколько потратил сегодня?', today: '2026-10-30' })).toEqual({ result: 'question', answer: 'Сегодня трат нет.', search: null });
    expect(asked).toHaveLength(1);
    expect(asked[0].system).toContain('"result":"payment"');
    expect(asked[0].system).toContain('Сегодня (2026-10-30)');
    // Уточняющий вопрос уходит вместе с прошлым — и «search» для «Показать операции».
    setAiTransport(async (req) => {
      asked.push(req as never);
      return '{"result":"question","answer":"В сентябре на кафе 1 000 RUB.","search":"Кофемания"}';
    });
    const follow = await call(d, 'me', 'POST', ['ai', 'say'], { text: 'а в сентябре?', today: '2026-10-30', history: [{ q: 'сколько на кафе?', a: 'В октябре 500 RUB.' }] });
    expect(follow).toEqual({ result: 'question', answer: 'В сентябре на кафе 1 000 RUB.', search: 'Кофемания' });
    expect(asked[1].user).toContain('Вопрос: сколько на кафе?');
    expect(asked[1].user).toContain('Теперь: а в сентябре?');
    // Запись — черновики, ничего не сохранено.
    setAiTransport(async () => '{"result":"payment","ops":[{"kind":"expense","amount":350,"payee":"Кофе","category":"Кафе","date":"2026-10-30"}]}');
    const r = await call(d, 'me', 'POST', ['ai', 'say'], { text: 'кофе 350', today: '2026-10-30' });
    expect(r.result).toBe('payment');
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ kind: 'expense', amount_minor: 35000, payee: 'Кофе' });
    // Без result, но с ops — запись; ни того ни другого — понятная ошибка.
    setAiTransport(async () => '{"ops":[{"kind":"expense","amount":90,"payee":"Шоколадка"}]}');
    expect((await call(d, 'me', 'POST', ['ai', 'say'], { text: 'шоколадка 90', today: '2026-10-30' })).result).toBe('payment');
    setAiTransport(async () => '{"result":"payment","ops":[]}');
    expect((await fail(call(d, 'me', 'POST', ['ai', 'say'], { text: 'привет', today: '2026-10-30' })))?.status).toBe(422);
  });
});
