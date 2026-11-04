import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';
import { merchantCategory, samePayee } from '@/lib/moneyMerchants';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { resetRatesClock, setRatesTransport, saveRates } = await import('../moneyRates');
const { budgetPushes, eveningText, moneyPushes } = await import('../moneyPush');
const { guessCategory } = await import('../moneySms');
const { readFrequent } = await import('../moneyFrequent');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me@example.com', 'x')").run();
  current = d;
  return d;
}

function call(d: Database.Database, method: string, path: string[], body: Record<string, unknown> = {}, query = '') {
  return money({ d, userId: 'me', method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;
}
const fail = (p: Promise<unknown>) => p.then(() => null, (e: { status: number }) => e);

beforeEach(() => {
  process.env.MONEY_USERS = '*';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
});

async function world(d: Database.Database) {
  await call(d, 'POST', ['onboard'], { base_currency: 'RUB', currencies: [] });
  const s = (await call(d, 'GET', ['state'], {}, '?month=2026-10')) as MoneyState;
  const card = s.accounts[0];
  const cat = (name: string) => s.categories.find((c) => c.name === name)!.id;
  saveRates(d, { day: '2026-09-01', rates: { USD: 80 } });
  const op = (body: Record<string, unknown>) => call(d, 'POST', ['ops'], { kind: 'expense', account_id: card.id, ...body });
  await op({ day: '2026-09-10', amount_minor: 100000, category_id: cat('Кафе'), payee: 'Кофемания' });
  await op({ day: '2026-10-05', amount_minor: 50000, category_id: cat('Кафе'), payee: 'Кофемания' });
  await op({ day: '2026-10-20', amount_minor: 90000, category_id: cat('Транспорт'), payee: 'Uber' });
  await op({ day: '2026-10-25', amount_minor: 147760, category_id: cat('Продукты'), payee: 'Пятёрочка' });
  return { card, cat, op };
}

describe('отчёты: по дням и одна категория', () => {
  it('неделя по дням Пн…Вс', async () => {
    const d = setup();
    await world(d);
    const w = await call(d, 'GET', ['report'], {}, '?period=week&day=2026-10-21&scope=all');
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toEqual({ day: '2026-10-19', spend: 0 });
    expect(w.days[1]).toEqual({ day: '2026-10-20', spend: 90000 });
    expect(w.days[6]).toEqual({ day: '2026-10-25', spend: 147760 });
    expect((await call(d, 'GET', ['report'], {}, '?period=month&day=2026-10-21&scope=all')).days).toEqual([]);
  });

  it('категория: траты за период и 6 месяцев', async () => {
    const d = setup();
    const { cat } = await world(d);
    const r = await call(d, 'GET', ['report', 'category'], {}, `?cat=${cat('Кафе')}&period=month&day=2026-10-30&scope=all`);
    expect(r.ops).toEqual([{ id: expect.any(String), day: '2026-10-05', payee: 'Кофемания', base_minor: 50000 }]);
    expect(r.trend.map((t: { short: string }) => t.short)).toEqual(['май', 'июн', 'июл', 'авг', 'сен', 'окт']);
    expect(r.trend.slice(-2).map((t: { spend: number }) => t.spend)).toEqual([100000, 50000]);
  });
});

describe('push «Денег»', () => {
  it('бюджет: 80% и 100% — по одному разу за месяц', async () => {
    const d = setup();
    const { cat, op } = await world(d);
    await call(d, 'PUT', ['budgets'], { category_id: cat('Кафе'), limit_minor: 60000 });
    // Траты месяца считаются по текущему месяцу дня — октябрь.
    const first = budgetPushes(d, 'me', '2026-10-30');
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe('«Кафе»: потрачено 83% бюджета');
    expect(budgetPushes(d, 'me', '2026-10-30')).toEqual([]);
    await op({ day: '2026-10-29', amount_minor: 20000, category_id: cat('Кафе'), payee: 'Кофемания' });
    const over = budgetPushes(d, 'me', '2026-10-30');
    expect(over.map((p) => p.title)).toEqual(['Бюджет «Кафе» кончился']);
    expect(over[0].body).toContain('сверх на 100');
    // Выключили — молчим.
    await call(d, 'PATCH', ['settings'], { budget_push: false });
    await call(d, 'PUT', ['budgets'], { category_id: cat('Транспорт'), limit_minor: 1000 });
    expect(budgetPushes(d, 'me', '2026-10-30')).toEqual([]);
  });

  it('вечерний итог: в своё время, раз в день, не в тихие часы', async () => {
    const d = setup();
    await world(d);
    expect(eveningText(d, 'me', '2026-10-25').body.replace(/[  ]/g, ' ')).toBe('Сегодня 1 478 ₽ · 1 операция. Больше всего — Продукты, 1 478 ₽.');
    expect(eveningText(d, 'me', '2026-10-26').body).toContain('трат не записано');
    expect((await fail(call(d, 'PATCH', ['settings'], { evening_push: '25:00' })))?.status).toBe(400);
    await call(d, 'PATCH', ['settings'], { evening_push: '21:00' });
    expect(moneyPushes(d, 'me', '2026-10-25', 21 * 60 + 3, true)).toEqual([]);
    expect(moneyPushes(d, 'me', '2026-10-25', 20 * 60, false)).toEqual([]);
    expect(moneyPushes(d, 'me', '2026-10-25', 21 * 60 + 3, false).map((p) => p.title)).toEqual(['Траты за день']);
    expect(moneyPushes(d, 'me', '2026-10-25', 21 * 60 + 5, false)).toEqual([]);
  });
});

describe('категории для SMS и частые траты', () => {
  it('категория места: прошлая операция (кириллица без регистра), иначе словарь', async () => {
    const d = setup();
    const { cat } = await world(d);
    expect(guessCategory(d, 'me', 'КОФЕМАНИЯ', 'expense')).toBe(cat('Кафе'));
    expect(guessCategory(d, 'me', 'uber', 'expense')).toBe(cat('Транспорт'));
    expect(guessCategory(d, 'me', 'Urent', 'expense')).toBe(cat('Транспорт'));
    expect(guessCategory(d, 'me', 'Аптека 36,6', 'expense')).toBe(cat('Здоровье'));
    expect(guessCategory(d, 'me', 'ИП Иванов', 'expense')).toBeNull();
    expect(merchantCategory('ЯндексGo')).toBe('Транспорт');
    expect(merchantCategory('Самокат')).toBe('Продукты');
    expect(samePayee('Ёлка  Маркет', 'елка маркет')).toBe(true);
  });

  it('поставили категорию месту — такие же траты без категории получают её', async () => {
    const d = setup();
    const { cat, op } = await world(d);
    const a = await op({ day: '2026-10-10', amount_minor: 6363, payee: 'ВелоПрокат' });
    await op({ day: '2026-10-11', amount_minor: 7000, payee: 'велопрокат' });
    const s = (await call(d, 'GET', ['state'], {}, '?month=2026-10')) as MoneyState;
    const o = s.ops.find((x) => x.id === a.id)!;
    const r = await call(d, 'PATCH', ['ops', a.id], { ...o, category_id: cat('Транспорт') });
    expect(r).toEqual({ ok: true, also: 1 });
    const after = (await call(d, 'GET', ['state'], {}, '?month=2026-10')) as MoneyState;
    expect(after.ops.filter((x) => x.payee?.toLowerCase() === 'велопрокат').every((x) => x.category_id === cat('Транспорт'))).toBe(true);
  });

  it('частые траты: то же место, сумма и счёт — 3 раза за 60 дней', async () => {
    const d = setup();
    const { cat, op } = await world(d);
    for (const day of ['2026-10-01', '2026-10-08', '2026-10-15']) await op({ day, amount_minor: 35000, category_id: cat('Кафе'), payee: 'Кофе' });
    await op({ day: '2026-10-16', amount_minor: 40000, payee: 'Кофе' });
    const f = readFrequent(d, 'me', '2026-10-30');
    expect(f).toEqual([{ payee: 'Кофе', amount_minor: 35000, currency: 'RUB', account_id: expect.any(String), category_id: cat('Кафе'), count: 3 }]);
    expect(readFrequent(d, 'me', '2027-01-30')).toEqual([]);
  });
});
