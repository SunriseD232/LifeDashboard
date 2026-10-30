import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

// В тестах база — своя, а не файл приложения.
let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { resetRatesClock, setRatesTransport, refreshRates, latestRates, saveRates, todayRates } = await import('../moneyRates');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  user.run('me', 'me@example.com');
  user.run('wife', 'wife@example.com');
  user.run('stranger', 'stranger@example.com');
  current = d;
  return d;
}

function call(d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}, query = '') {
  return money({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL(`http://x/${query}`) } } as unknown as Ctx) as Promise<any>;
}
const state = (d: Database.Database, userId: string, month = '2026-10') => call(d, userId, 'GET', ['state'], {}, `?month=${month}`) as Promise<MoneyState>;
const fail = (p: Promise<unknown>) => p.then(() => null, (e: { status: number; message: string }) => e);

beforeEach(() => {
  process.env.MONEY_USERS = 'me@example.com, wife';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
});

async function onboard(d: Database.Database, userId: string) {
  await call(d, userId, 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['USD', 'EUR', 'RUB'] });
  return (await state(d, userId)).accounts[0];
}

describe('доступ', () => {
  it('только тем, кто в MONEY_USERS (по логину или id)', async () => {
    const d = setup();
    expect((await fail(state(d, 'stranger')))?.status).toBe(403);
    expect((await state(d, 'me')).settings).toBeNull();
    expect((await state(d, 'wife')).settings).toBeNull();
    process.env.MONEY_USERS = '*';
    expect((await state(d, 'stranger')).settings).toBeNull();
  });
});

describe('первый запуск', () => {
  it('сохраняет валюты, заводит категории и первый счёт', async () => {
    const d = setup();
    const acc = await onboard(d, 'me');
    const s = await state(d, 'me');
    expect(s.settings).toEqual({ base_currency: 'RUB', currencies: ['USD', 'EUR'], hidden: [] });
    expect(acc).toMatchObject({ name: 'Карта', currency: 'RUB', balance_minor: 0, mine: true, shared: false });
    expect(s.categories.filter((c) => c.kind === 'expense').map((c) => c.name)).toContain('Продукты');
    expect(s.categories.some((c) => c.kind === 'income' && c.name === 'Зарплата')).toBe(true);
    // Повторный — не плодит счета и категории.
    await call(d, 'me', 'POST', ['onboard'], { base_currency: 'EUR', currencies: ['USD'] });
    const again = await state(d, 'me');
    expect(again.accounts).toHaveLength(1);
    expect(again.categories).toHaveLength(s.categories.length);
    expect(again.settings?.base_currency).toBe('EUR');
  });
  it('без первого запуска операции не принимает', async () => {
    const d = setup();
    expect((await fail(call(d, 'me', 'POST', ['accounts'], { name: 'X', currency: 'RUB' })))?.status).toBe(409);
  });
  it('незнакомую валюту не принимает', async () => {
    const d = setup();
    expect((await fail(call(d, 'me', 'POST', ['onboard'], { base_currency: 'XXX' })))?.status).toBe(400);
  });
});

describe('операции и остатки', () => {
  it('расход, доход, перевод и обмен меняют остатки', async () => {
    const d = setup();
    const rub = await onboard(d, 'me');
    const { id: usd } = await call(d, 'me', 'POST', ['accounts'], { name: 'Wise', currency: 'USD', opening_minor: 125000 });
    const { id: cash } = await call(d, 'me', 'POST', ['accounts'], { name: 'Наличные', kind: 'cash', currency: 'RUB' });
    const food = (await state(d, 'me')).categories.find((c) => c.name === 'Продукты')!;
    await call(d, 'me', 'POST', ['ops'], { kind: 'income', day: '2026-10-29', account_id: rub.id, amount_minor: 12000000 });
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-10-30', account_id: rub.id, amount_minor: 147760, category_id: food.id, payee: 'Пятёрочка' });
    await call(d, 'me', 'POST', ['ops'], { kind: 'transfer', day: '2026-10-30', account_id: rub.id, to_account_id: cash, amount_minor: 500000 });
    await call(d, 'me', 'POST', ['ops'], { kind: 'exchange', day: '2026-10-30', account_id: usd, to_account_id: rub.id, amount_minor: 50000, to_amount_minor: 4025000 });
    const s = await state(d, 'me');
    const bal = Object.fromEntries(s.accounts.map((a) => [a.name, a.balance_minor]));
    expect(bal).toEqual({ Карта: 12000000 - 147760 - 500000 + 4025000, Wise: 75000, Наличные: 500000 });
    expect(s.ops).toHaveLength(4);
    expect(s.ops[0].day).toBe('2026-10-30');
    expect(s.ops.find((o) => o.payee === 'Пятёрочка')).toMatchObject({ category_name: 'Продукты', currency: 'RUB', mine: true, author: null });
    // Другой месяц — пусто.
    expect((await state(d, 'me', '2026-09')).ops).toHaveLength(0);
  });

  it('проверяет перевод и обмен', async () => {
    const d = setup();
    const rub = await onboard(d, 'me');
    const { id: usd } = await call(d, 'me', 'POST', ['accounts'], { name: 'Wise', currency: 'USD' });
    const { id: rub2 } = await call(d, 'me', 'POST', ['accounts'], { name: 'Нал', currency: 'RUB' });
    const day = '2026-10-30';
    expect((await fail(call(d, 'me', 'POST', ['ops'], { kind: 'transfer', day, account_id: rub.id, to_account_id: usd, amount_minor: 100 })))?.message).toMatch(/обмен/);
    expect((await fail(call(d, 'me', 'POST', ['ops'], { kind: 'exchange', day, account_id: rub.id, to_account_id: rub2, amount_minor: 100, to_amount_minor: 100 })))?.message).toMatch(/перевод/);
    expect((await fail(call(d, 'me', 'POST', ['ops'], { kind: 'transfer', day, account_id: rub.id, to_account_id: rub.id, amount_minor: 100 })))?.status).toBe(400);
    expect((await fail(call(d, 'me', 'POST', ['ops'], { kind: 'expense', day, account_id: rub.id, amount_minor: 0 })))?.status).toBe(400);
    expect((await fail(call(d, 'me', 'POST', ['ops'], { kind: 'expense', day, account_id: rub.id, amount_minor: 1.5 })))?.status).toBe(400);
    expect((await fail(call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '30.10', account_id: rub.id, amount_minor: 100 })))?.status).toBe(400);
  });

  it('позиции чека: сохраняет, нормализует названия, отдаёт по операции', async () => {
    const d = setup();
    const rub = await onboard(d, 'me');
    const cats = (await state(d, 'me')).categories;
    const chem = cats.find((c) => c.name === 'Бытовая химия')!;
    const { id } = await call(d, 'me', 'POST', ['ops'], {
      kind: 'expense',
      day: '2026-10-30',
      account_id: rub.id,
      amount_minor: 48880,
      source: 'photo',
      items: [
        { name: 'Молоко 2,5% 930 мл', qty: 2, price_minor: 8990, total_minor: 17980 },
        { name: 'Средство для посуды', total_minor: 21900, category_id: chem.id },
        { name: 'Губки, 5 шт', total_minor: 9000 },
      ],
    });
    const op = (await state(d, 'me')).ops[0];
    expect(op).toMatchObject({ items_count: 3, source: 'photo' });
    const { items } = await call(d, 'me', 'GET', ['ops', id]);
    expect(items.map((i: { norm_name: string }) => i.norm_name)).toEqual(['молоко', 'средство для посуды', 'губки']);
    expect(items[0]).toMatchObject({ qty: 2, price_minor: 8990, total_minor: 17980 });
    expect(items[1].category_id).toBe(chem.id);
    // Правка без items — позиции остаются; с пустым списком — убираются.
    await call(d, 'me', 'PATCH', ['ops', id], { kind: 'expense', day: '2026-10-30', account_id: rub.id, amount_minor: 48880, note: 'чек' });
    expect((await call(d, 'me', 'GET', ['ops', id])).items).toHaveLength(3);
    await call(d, 'me', 'PATCH', ['ops', id], { kind: 'expense', day: '2026-10-30', account_id: rub.id, amount_minor: 48880, items: [] });
    expect((await call(d, 'me', 'GET', ['ops', id])).items).toHaveLength(0);
  });

  it('покупка в другой валюте: сохраняет исходную сумму', async () => {
    const d = setup();
    const rub = await onboard(d, 'me');
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-10-29', account_id: rub.id, amount_minor: 113280, orig_amount_minor: 1200, orig_currency: 'EUR' });
    expect((await state(d, 'me')).ops[0]).toMatchObject({ amount_minor: 113280, currency: 'RUB', orig_amount_minor: 1200, orig_currency: 'EUR' });
  });

  it('счёт с операциями не удалить, только в архив; валюту не сменить', async () => {
    const d = setup();
    const rub = await onboard(d, 'me');
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-10-30', account_id: rub.id, amount_minor: 100 });
    expect((await fail(call(d, 'me', 'DELETE', ['accounts', rub.id])))?.message).toMatch(/архив/);
    expect((await fail(call(d, 'me', 'PATCH', ['accounts', rub.id], { currency: 'USD' })))?.status).toBe(400);
    await call(d, 'me', 'PATCH', ['accounts', rub.id], { archived: true, name: 'Старая карта' });
    expect((await state(d, 'me')).accounts[0]).toMatchObject({ archived: true, name: 'Старая карта' });
    const { id: empty } = await call(d, 'me', 'POST', ['accounts'], { name: 'Пустой', currency: 'GEL' });
    expect((await state(d, 'me')).settings?.currencies).toContain('GEL');
    await call(d, 'me', 'DELETE', ['accounts', empty]);
    expect((await state(d, 'me')).accounts).toHaveLength(1);
  });
});

describe('семья', () => {
  function family(d: Database.Database) {
    d.prepare("insert into households (id, name, created_by) values ('h', 'Мы', 'me')").run();
    d.prepare("insert into household_members (user_id, household_id) values ('me', 'h'), ('wife', 'h')").run();
  }

  it('семейный счёт и его операции видны обоим, личный — только хозяину', async () => {
    const d = setup();
    family(d);
    const mine = await onboard(d, 'me');
    await onboard(d, 'wife');
    const { id: shared } = await call(d, 'me', 'POST', ['accounts'], { name: 'Общий', currency: 'RUB', shared: true });
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-10-30', account_id: mine.id, amount_minor: 100, payee: 'личное' });
    const wifeCats = (await state(d, 'wife')).categories;
    await call(d, 'wife', 'POST', ['ops'], { kind: 'expense', day: '2026-10-29', account_id: shared, amount_minor: 234000, payee: 'ВкусВилл', category_id: wifeCats[0].id });

    const w = await state(d, 'wife');
    expect(w.family).toBe(true);
    expect(w.accounts.map((a) => a.name).sort()).toEqual(['Карта', 'Общий']);
    expect(w.accounts.find((a) => a.name === 'Общий')).toMatchObject({ shared: true, mine: false, author: 'me@example.com', balance_minor: -234000 });
    expect(w.ops.map((o) => o.payee)).toEqual(['ВкусВилл']);

    const m = await state(d, 'me');
    expect(m.ops.map((o) => o.payee)).toEqual(['личное', 'ВкусВилл']);
    const theirs = m.ops.find((o) => o.payee === 'ВкусВилл')!;
    expect(theirs).toMatchObject({ mine: false, author: 'wife@example.com', category_name: wifeCats[0].name });
    // Чужую семейную операцию можно править, оставив её категорию.
    await call(d, 'me', 'PATCH', ['ops', theirs.id], { kind: 'expense', day: '2026-10-29', account_id: shared, amount_minor: 230000, category_id: theirs.category_id, payee: 'ВкусВилл' });
    expect((await state(d, 'me')).accounts.find((a) => a.name === 'Общий')?.balance_minor).toBe(-230000);

    // Личный счёт мужа жене не виден и не доступен.
    expect((await fail(call(d, 'wife', 'POST', ['ops'], { kind: 'expense', day: '2026-10-30', account_id: mine.id, amount_minor: 1 })))?.status).toBe(400);
    const myOp = m.ops.find((o) => o.payee === 'личное')!;
    expect((await fail(call(d, 'wife', 'DELETE', ['ops', myOp.id])))?.status).toBe(404);
    // Семейный счёт меняет только тот, кто завёл.
    expect((await fail(call(d, 'wife', 'PATCH', ['accounts', shared], { name: 'Наш' })))?.status).toBe(403);
  });

  it('семейный счёт без семьи не завести', async () => {
    const d = setup();
    await onboard(d, 'me');
    expect((await fail(call(d, 'me', 'POST', ['accounts'], { name: 'Общий', currency: 'RUB', shared: true })))?.status).toBe(400);
  });
});

describe('курсы', () => {
  it('грузит курсы ЦБ, не вышло — зеркало; свой курс для USDT', async () => {
    const d = setup();
    const urls: string[] = [];
    setRatesTransport(async (url) => {
      urls.push(url);
      if (url.includes('cbr.ru')) throw new Error('timeout');
      return { ok: true, text: async () => JSON.stringify({ Date: '2026-10-30T11:30:00+03:00', Valute: { USD: { Nominal: 1, Value: 81.6 } } }) };
    });
    await refreshRates(d, Date.parse('2026-10-30T09:00:00Z'));
    expect(urls).toHaveLength(2);
    expect(latestRates(d)).toEqual({ rates: { USD: 81.6 }, day: '2026-10-30' });
    // Сегодняшние уже есть — второй раз не ходит.
    resetRatesClock();
    await refreshRates(d, Date.parse('2026-10-30T10:00:00Z'));
    expect(urls).toHaveLength(2);

    await onboard(d, 'me');
    await call(d, 'me', 'POST', ['rates'], { currency: 'USDT', rate: 80.9 });
    const s = await state(d, 'me');
    expect(s.user_rates).toEqual({ USDT: 80.9 });
    expect(s.rates.RUB).toBe(1);
    expect((await fail(call(d, 'me', 'POST', ['rates'], { currency: 'USDT', rate: -1 })))?.status).toBe(400);
  });

  it('завтрашние курсы ЦБ не берёт раньше времени', () => {
    const d = setup();
    saveRates(d, { day: '2026-10-30', rates: { USD: 80.56 } });
    saveRates(d, { day: '2026-10-31', rates: { USD: 81, EUR: 94 } });
    expect(todayRates(d, Date.parse('2026-10-30T15:00:00Z'))).toEqual({ rates: { USD: 80.56, EUR: 94 }, day: '2026-10-30' });
    expect(todayRates(d, Date.parse('2026-10-30T22:00:00Z')).rates.USD).toBe(81);
  });
});
