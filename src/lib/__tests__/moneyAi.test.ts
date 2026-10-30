import { describe, expect, it } from 'vitest';
import { mainCategory, needsAi, parseDrafts, parseFiscalQr, parseReceipt, toMinor, type AiContext } from '../moneyAi';

const ctx: AiContext = {
  accounts: [
    { id: 'tb', name: 'Т-Банк', currency: 'RUB' },
    { id: 'rev', name: 'Revolut', currency: 'EUR' },
    { id: 'old', name: 'Старая', currency: 'USD', archived: true },
  ],
  categories: [
    { id: 'food', kind: 'expense', name: 'Продукты' },
    { id: 'cafe', kind: 'expense', name: 'Кафе' },
    { id: 'taxi', kind: 'expense', name: 'Транспорт' },
    { id: 'chem', kind: 'expense', name: 'Бытовая химия' },
    { id: 'pay', kind: 'income', name: 'Зарплата' },
  ],
  today: '2026-10-30',
  base: 'RUB',
};

describe('toMinor', () => {
  it('по разрядам валюты, отбрасывает мусор', () => {
    expect(toMinor(12.4, 'EUR')).toBe(1240);
    expect(toMinor('1 200,50', 'RUB')).toBe(120050);
    expect(toMinor(5000, 'JPY')).toBe(5000);
    expect(toMinor(0, 'RUB')).toBeNull();
    expect(toMinor(-3, 'RUB')).toBeNull();
    expect(toMinor('много', 'RUB')).toBeNull();
  });
});

describe('parseDrafts', () => {
  it('несколько трат, счета и категории по названиям', () => {
    const ops = parseDrafts(
      {
        ops: [
          { kind: 'expense', amount: 1200, currency: null, account: null, category: 'Продукты', payee: 'Пятёрочка', date: '2026-10-30' },
          { kind: 'expense', amount: 12, currency: 'eur', account: null, category: 'транспорт', payee: 'Такси', date: '2026-10-29' },
          { kind: 'income', amount: 90000, account: 'т-банк', category: 'Зарплата', date: '2026-11-05' },
          { kind: 'expense', amount: 0, payee: 'пусто' },
        ],
      },
      ctx,
      'фраза',
    );
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ kind: 'expense', amount_minor: 120000, currency: null, category_id: 'food', payee: 'Пятёрочка', day: '2026-10-30', said: 'фраза' });
    // Валюту назвали — счёт в ней.
    expect(ops[1]).toMatchObject({ amount_minor: 1200, currency: 'EUR', account_id: 'rev', category_id: 'taxi', day: '2026-10-29' });
    // Будущая дата — сегодня; категория доходов — из доходов.
    expect(ops[2]).toMatchObject({ kind: 'income', account_id: 'tb', category_id: 'pay', day: '2026-10-30' });
  });

  it('обмен: куда и сколько получил; архивный счёт не берёт', () => {
    const [op] = parseDrafts({ ops: [{ kind: 'exchange', amount: 50000, currency: 'RUB', account: 'Т-Банк', to_account: 'Revolut', to_amount: 520.5 }] }, ctx);
    expect(op).toMatchObject({ kind: 'exchange', account_id: 'tb', to_account_id: 'rev', to_amount_minor: 52050 });
    expect(parseDrafts({ ops: [{ amount: 5, currency: 'USD' }] }, ctx)[0].account_id).toBeUndefined();
  });

  it('не тот ответ — пусто', () => {
    expect(parseDrafts(null, ctx)).toEqual([]);
    expect(parseDrafts({ ops: 'нет' }, ctx)).toEqual([]);
  });
});

describe('parseReceipt', () => {
  it('позиции, единицы, категории; история важнее ИИ', () => {
    const r = parseReceipt(
      {
        payee: 'Пятёрочка',
        date: '2026-10-30',
        time: '18:42',
        currency: 'RUB',
        total: 1477.6,
        items: [
          { name: 'Молоко 2,5% 930 мл', qty: 2, unit: 'шт.', price: 89.9, total: 179.8, category: 'Продукты' },
          { name: 'Средство для посуды', qty: 1, total: 219, category: 'Продукты' },
          { name: 'Бананы', qty: 1.2, unit: 'КГ', price: 129.92, total: 155.9, category: 'Продукты' },
          { name: '', total: 10 },
          { name: 'Ноль', total: 0 },
        ],
      },
      ctx,
      (name) => (name.startsWith('Средство') ? 'chem' : null),
    )!;
    expect(r).toMatchObject({ payee: 'Пятёрочка', day: '2026-10-30', time: '18:42', currency: 'RUB', total_minor: 147760 });
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toEqual({ name: 'Молоко 2,5% 930 мл', qty: 2, unit: 'шт', price_minor: 8990, total_minor: 17980, category_id: 'food' });
    expect(r.items[1].category_id).toBe('chem');
    expect(r.items[2]).toMatchObject({ qty: 1.2, unit: 'кг' });
  });

  it('нет итога — сумма позиций; чужая валюта; ничего — null', () => {
    const r = parseReceipt({ currency: 'EUR', items: [{ name: 'Brot', total: 2.49 }, { name: 'Milch', total: 1.1 }] }, ctx)!;
    expect(r).toMatchObject({ currency: 'EUR', total_minor: 359, day: '2026-10-30', time: null });
    expect(parseReceipt({ items: [] }, ctx)).toBeNull();
  });

  it('главная категория — по сумме', () => {
    expect(mainCategory([{ category_id: 'food', total_minor: 100 }, { category_id: 'chem', total_minor: 150 }, { category_id: 'food', total_minor: 60 }])).toBe('food');
    expect(mainCategory([{ category_id: null, total_minor: 5 }])).toBeNull();
  });
});

describe('QR кассового чека', () => {
  it('сумма, дата, время и вид', () => {
    expect(parseFiscalQr('t=20261030T1842&s=1477.60&fn=7380440700076549&i=41975&fp=2346241953&n=1')).toEqual({ day: '2026-10-30', time: '18:42', total_minor: 147760, type: 1 });
    expect(parseFiscalQr('https://check.ofd.ru/?t=20261001T090500&s=99&fn=1&i=2&fp=3&n=2')).toMatchObject({ total_minor: 9900, type: 2, time: '09:05' });
  });
  it('не чек — null', () => {
    expect(parseFiscalQr('https://example.com')).toBeNull();
    expect(parseFiscalQr('t=20261030T1842&s=10')).toBeNull();
  });
});

describe('когда звать ИИ', () => {
  it('простое — сами, сложное — ИИ', () => {
    expect(needsAi('кофе 350', true)).toBe(false);
    expect(needsAi('такси 12 € вчера', true)).toBe(false);
    expect(needsAi('продукты 1200 и кофе 350', true)).toBe(true);
    expect(needsAi('такси двенадцать евро', false)).toBe(true);
    expect(needsAi('заправился на трассе под Тверью за 3000', true)).toBe(true);
  });
});
