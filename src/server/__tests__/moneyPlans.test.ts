import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { dropSmsRefunds, readSmsBody, smsIncoming } = await import('../moneySms');
const { setFnsTransport } = await import('../moneyFns');
const { parseBankSms } = await import('@/lib/moneySms');
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
  it('тело — как пришлёт MacroDroid: JSON, JSON с переносом строки внутри, форма, просто текст', () => {
    expect(readSmsBody('{"text":"Покупка 350 ₽"}')).toEqual({ text: 'Покупка 350 ₽' });
    expect(readSmsBody('{"text":"Т-Банк\nПокупка 350 ₽"}').text).toBe('Т-Банк Покупка 350 ₽');
    expect(readSmsBody('text=%D0%9F%D0%BE%D0%BA%D1%83%D0%BF%D0%BA%D0%B0+350')).toMatchObject({ text: 'Покупка 350' });
    expect(readSmsBody('СберБанк\nПокупка 350р')).toEqual({ text: 'СберБанк\nПокупка 350р' });
    expect(parseBankSms('Пополнение Перевод от Иван И. +5 000 ₽ Баланс 15 000 ₽')?.payee).toBe('Перевод от Иван И');
  });

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

  it('списали 1 ₽ и вернули — не операция; возврат покупки отменяет трату', async () => {
    const d = setup();
    const { card } = await world(d);
    const { token } = await call(d, 'me', 'POST', ['sms'], { account_id: card.id });
    const count = () => (d.prepare("select count(*) n from money_ops where user_id = 'me'").get() as { n: number }).n;
    smsIncoming(d, `Bearer ${token}`, { text: 'Покупка 1р YANDEX.GO Баланс: 999р' });
    expect(count()).toBe(1);
    expect(smsIncoming(d, `Bearer ${token}`, { text: 'Зачисление 1р YANDEX.GO Баланс: 1000р' })).toMatchObject({ skipped: 'возврат — трата отменена' });
    expect(count()).toBe(0);

    // Возврат по тексту — даже если место написано иначе.
    smsIncoming(d, `Bearer ${token}`, { text: 'Покупка 2490р OZON.RU Баланс: 999р' });
    expect(smsIncoming(d, `Bearer ${token}`, { text: 'Возврат покупки 2490р OZON Баланс: 3489р' })).toMatchObject({ skipped: 'возврат — трата отменена' });
    expect(count()).toBe(0);

    // Просто поступление той же суммы от другого — обычный доход.
    smsIncoming(d, `Bearer ${token}`, { text: 'Покупка 500р KOFE Баланс: 999р' });
    expect(smsIncoming(d, `Bearer ${token}`, { text: 'Перевод от Иван И. +500 ₽ Баланс 1499 ₽' })).toMatchObject({ ok: true, id: expect.any(String) });
    expect(count()).toBe(2);
  });

  it('старые пары «списали — вернули» убираются при загрузке', async () => {
    const d = setup();
    const { card } = await world(d);
    const add = (kind: string, amount: number, payee: string, source = 'sms') =>
      d
        .prepare("insert into money_ops (id, user_id, kind, day, account_id, amount_minor, currency, payee, source) values (?, 'me', ?, ?, ?, ?, 'RUB', ?, ?)")
        .run(`${kind}${amount}${payee}${source}`, kind, moscowDay(), card.id, amount, payee, source);
    add('expense', 100, 'Yandex.go');
    add('income', 100, 'Yandex.go');
    add('expense', 99000, 'Mvideo');
    add('income', 99000, 'Работа');
    add('expense', 100, 'Ручная', 'manual');
    add('income', 100, 'Ручная');
    expect(dropSmsRefunds(d, 'me', moscowDay())).toBe(1);
    const left = (d.prepare("select payee from money_ops where user_id = 'me' order by payee").all() as { payee: string }[]).map((r) => r.payee);
    expect(left.sort()).toEqual(['Mvideo', 'Работа', 'Ручная', 'Ручная']);
  });
});

describe('чек по QR из ФНС', () => {
  it('позиции по QR; без ключа — понятный отказ; ответ «ещё не дошёл»', async () => {
    const d = setup();
    await world(d);
    const qr = 't=20261102T1406&s=258.80&fn=7380440903554565&i=22082&fp=662283413&n=1';
    delete process.env.PROVERKACHEKA_TOKEN;
    expect((await state(d)).fns).toBe(false);
    expect((await fail(call(d, 'me', 'POST', ['receipt', 'qr'], { qr, today: '2026-11-02' })))?.status).toBe(503);

    process.env.PROVERKACHEKA_TOKEN = 'tok';
    let sent: URLSearchParams | null = null;
    setFnsTransport(async (body) => {
      sent = body;
      return { code: 1, data: { json: { user: 'ООО "АГРОТОРГ"', totalSum: 25880, dateTime: '2026-11-02T14:06:00', items: [{ name: 'Напиток энерг. ADRENALINE', price: 12990, quantity: 1, sum: 12990 }, { name: 'Бананы', price: 15900, quantity: 0.81, sum: 12890 }] } } };
    });
    expect((await state(d)).fns).toBe(true);
    const { receipt } = await call(d, 'me', 'POST', ['receipt', 'qr'], { qr, today: '2026-11-02' });
    expect(sent!.get('qrraw')).toBe(qr);
    expect(sent!.get('token')).toBe('tok');
    expect(receipt).toMatchObject({ payee: 'Агроторг', day: '2026-11-02', total_minor: 25880 });
    expect(receipt.items).toHaveLength(2);

    expect((await fail(call(d, 'me', 'POST', ['receipt', 'qr'], { qr: 'https://example.com', today: '2026-11-02' })))?.status).toBe(400);
    setFnsTransport(async () => ({ code: 2, data: 'нет' }));
    expect((await fail(call(d, 'me', 'POST', ['receipt', 'qr'], { qr, today: '2026-11-02' })))?.message).toMatch(/ещё не дошёл/);
    delete process.env.PROVERKACHEKA_TOKEN;
  });

  it('позиции чека приходят с операциями — для поиска', async () => {
    const d = setup();
    const { card } = await world(d);
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: moscowDay(), account_id: card.id, amount_minor: 25880, payee: 'Пятёрочка', items: [{ name: 'Напиток энерг. ADRENALINE', total_minor: 12990 }, { name: 'Бананы', total_minor: 12890 }] });
    await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: moscowDay(), account_id: card.id, amount_minor: 500, payee: 'Кофе' });
    const ops = (await state(d)).ops;
    expect(ops.find((o) => o.payee === 'Пятёрочка')!.items).toEqual([{ name: 'Напиток энерг. ADRENALINE', total_minor: 12990 }, { name: 'Бананы', total_minor: 12890 }]);
    expect(ops.find((o) => o.payee === 'Кофе')!.items).toBeUndefined();
  });
});
