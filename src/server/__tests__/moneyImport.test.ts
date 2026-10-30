import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';
import type { MoneyState } from '@/lib/money';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { money } = await import('../api/money');
const { setAiTransport } = await import('../ai');
const { resetRatesClock, setRatesTransport } = await import('../moneyRates');
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
const state = (d: Database.Database, userId: string) => call(d, userId, 'GET', ['state'], {}, '?month=2026-10') as Promise<MoneyState>;
const fail = (p: Promise<unknown>) => p.then(() => null, (e: { status: number; message: string }) => e);

async function onboard(d: Database.Database, userId: string) {
  await call(d, userId, 'POST', ['onboard'], { base_currency: 'RUB', currencies: ['EUR'] });
  return (await state(d, userId)).accounts[0];
}

let replies: string[] = [];
beforeEach(() => {
  process.env.MONEY_USERS = '*';
  process.env.AI_DAILY_LIMIT = '50';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
  replies = [];
  setAiTransport(async () => replies.shift() ?? '{}');
});
afterEach(() => setAiTransport(null));

const CSV =
  'Дата операции;Сумма;Валюта;Описание\n' +
  '30.10.2026;-1477,60;RUB;Оплата в PYATEROCHKA 1234\n' +
  '29.10.2026;-350,00;RUB;COFFEE LIKE\n' +
  '29.10.2026;-20000,00;RUB;Перевод на Wise\n' +
  '28.10.2026;120000,00;RUB;Зарплата ООО Ромашка\n';
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function readImport(d: Database.Database, userId: string, body: Record<string, unknown>) {
  const { job } = await call(d, userId, 'POST', ['import', 'start'], { today: '2026-10-30', ...body });
  for (let i = 0; i < 100; i++) {
    const j = await call(d, userId, 'GET', ['import', 'job'], {}, `?id=${job}`);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw Object.assign(new Error(j.error), { status: 422 });
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job timeout');
}

describe('импорт выписок', () => {
  it('CSV → подсказки ИИ → повторы → запись → повторный импорт ничего не задваивает', async () => {
    const d = setup();
    const card = await onboard(d, 'me');
    const wise = await call(d, 'me', 'POST', ['accounts'], { name: 'Wise', kind: 'card', currency: 'RUB', opening_minor: 0 });
    const food = (await state(d, 'me')).categories.find((c) => c.name === 'Продукты')!.id;
    // Кофе уже записан вручную днём позже.
    const manual = await call(d, 'me', 'POST', ['ops'], { kind: 'expense', day: '2026-10-30', account_id: card.id, amount_minor: 35000, payee: 'Кофе' });
    replies.push(
      JSON.stringify({
        items: [
          { i: 0, payee: 'Пятёрочка', category: 'Продукты' },
          { i: 1, payee: 'Coffee Like', category: 'Кафе' },
          { i: 2, payee: 'Wise', category: null, own_transfer: true },
          { i: 3, payee: 'ООО Ромашка', category: 'Зарплата' },
        ],
      }),
    );
    const res = await readImport(d, 'me', { kind: 'file', name: 'tbank.csv', data: b64(CSV) });
    expect(res).toMatchObject({ format: 'CSV', account_id: null, signature: 'table:дата операции|сумма|валюта|описание' });
    expect(res.rows.map((r: { payee: string }) => r.payee)).toEqual(['Пятёрочка', 'Coffee Like', 'Wise', 'ООО Ромашка']);
    expect(res.rows[0]).toMatchObject({ kind: 'expense', category_id: food, amount_minor: -147760 });
    expect(res.rows[2]).toMatchObject({ kind: 'transfer', to_account_id: wise.id, category_id: null });

    const { rows: checks } = await call(d, 'me', 'POST', ['import', 'check'], { account_id: card.id, rows: res.rows });
    expect(checks.map((c: { status: string }) => c.status)).toEqual(['new', 'link', 'new', 'new']);
    expect(checks[1]).toMatchObject({ op_id: manual.id, title: 'Кофе' });

    const rows = res.rows.map((r: Record<string, unknown>, i: number) =>
      checks[i].status === 'link' ? { key: r.key, action: 'link', link_id: checks[i].op_id } : { ...r, action: 'new', note: r.description },
    );
    expect(await call(d, 'me', 'POST', ['import', 'commit'], { account_id: card.id, rows, signature: res.signature, mapping: res.mapping })).toEqual({ added: 3, linked: 1 });
    const s = await state(d, 'me');
    expect(s.accounts.find((a) => a.id === card.id)!.balance_minor).toBe(-35000 - 147760 - 2000000 + 12000000);
    expect(s.accounts.find((a) => a.id === wise.id)!.balance_minor).toBe(2000000);
    expect(s.ops.filter((o) => o.source === 'import')).toHaveLength(3);

    // Та же выписка ещё раз: всё «уже есть», ИИ не нужен (история), счёт — как в прошлый раз.
    const again = await readImport(d, 'me', { kind: 'file', name: 'tbank.csv', data: b64(CSV) });
    expect(again.account_id).toBe(card.id);
    expect(again.rows[0]).toMatchObject({ payee: 'Пятёрочка', category_id: food });
    expect(replies).toHaveLength(0);
    const second = await call(d, 'me', 'POST', ['import', 'check'], { account_id: card.id, rows: again.rows });
    expect(second.rows.map((c: { status: string }) => c.status)).toEqual(['exists', 'exists', 'exists', 'exists']);

    // Выписка Wise: тот же перевод — склеиваем с уже импортированным, а не задваиваем.
    replies.push('{"items":[]}');
    const wiseRes = await readImport(d, 'me', { kind: 'file', name: 'wise.csv', data: b64('Date;Amount;Description\n29.10.2026;20000;From card\n') });
    const w = await call(d, 'me', 'POST', ['import', 'check'], { account_id: wise.id, rows: wiseRes.rows });
    expect(w.rows[0].status).toBe('link');
  });

  it('незнакомая таблица — ИИ определяет столбцы, шаблон запоминается', async () => {
    const d = setup();
    const acc = await onboard(d, 'me');
    const csv = 'Buchung|Wert|Text\n28.10.2026|-12,40|REWE\n';
    replies.push(JSON.stringify({ header_row: 0, date: 0, amount: 1, description: [2], date_order: 'dmy', bank: 'Sparkasse' }), '{"items":[]}');
    const res = await readImport(d, 'me', { kind: 'file', name: 'x.csv', data: b64(csv) });
    expect(res.rows).toHaveLength(1);
    expect(res.bank).toBe('Sparkasse');
    await call(d, 'me', 'POST', ['import', 'commit'], { account_id: acc.id, rows: [{ ...res.rows[0], action: 'new' }], signature: res.signature, mapping: res.mapping, bank: res.bank });
    // Второй раз — по шаблону, без вопроса к ИИ о столбцах.
    replies.push('{"items":[]}');
    const again = await readImport(d, 'me', { kind: 'file', name: 'x.csv', data: b64(csv + '29.10.2026|-5,00|DM\n') });
    expect(again.rows).toHaveLength(2);
    expect(again).toMatchObject({ bank: 'Sparkasse', account_id: acc.id });
    expect(replies).toHaveLength(0);
  });

  it('скриншоты: перекрытие склеивается; без ИИ — понятный отказ; .xls — подсказка', async () => {
    const d = setup();
    await onboard(d, 'me');
    const page = (txs: unknown[]) => JSON.stringify({ bank: 'Т-Банк', currency: 'RUB', txs });
    replies.push(
      page([
        { date: '2026-10-30', amount: -350, description: 'Кофе' },
        { date: '2026-10-30', amount: -1200, description: 'Пятёрочка' },
      ]),
      page([
        { date: '2026-10-30', amount: -1200, description: 'Пятёрочка' },
        { date: '2026-10-29', amount: -400, description: 'Такси' },
      ]),
      '{"items":[]}',
    );
    const img = 'data:image/png;base64,AAAA';
    const res = await readImport(d, 'me', { kind: 'screens', images: [img, img] });
    expect(res).toMatchObject({ format: 'Скриншоты', bank: 'Т-Банк', merged: 1 });
    expect(res.rows).toHaveLength(3);

    expect((await fail(readImport(d, 'me', { kind: 'file', name: 'a.xls', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString('base64') })))?.message).toContain('.xlsx');
    await call(d, 'me', 'PATCH', ['settings'], { hidden: ['ai'] });
    expect((await fail(readImport(d, 'me', { kind: 'screens', images: [img] })))?.message).toContain('ИИ');
  });

  it('задача чужого человека не видна; чужой счёт для записи — отказ', async () => {
    const d = setup();
    const acc = await onboard(d, 'me');
    await onboard(d, 'wife');
    replies.push('{"items":[]}');
    const { job } = await call(d, 'me', 'POST', ['import', 'start'], { today: '2026-10-30', kind: 'file', name: 'a.csv', data: b64(CSV) });
    expect((await fail(call(d, 'wife', 'GET', ['import', 'job'], {}, `?id=${job}`)))?.status).toBe(404);
    expect((await fail(call(d, 'wife', 'POST', ['import', 'commit'], { account_id: acc.id, rows: [{ key: 'k', action: 'new', day: '2026-10-30', amount_minor: -100 }] })))?.status).toBe(400);
  });
});
