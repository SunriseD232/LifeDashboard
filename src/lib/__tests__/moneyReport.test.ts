import { describe, expect, it } from 'vitest';
import { periodRange, priceHistory, priceStats, RateBook, spendParts, type PriceRow } from '../moneyReport';

describe('периоды', () => {
  it('месяц, неделя с понедельника, год, сдвиги', () => {
    expect(periodRange('month', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-31', short: 'окт', title: 'Октябрь 2026' });
    expect(periodRange('month', '2026-01-15', -1)).toMatchObject({ from: '2025-12-01', to: '2025-12-31', title: 'Декабрь 2025' });
    expect(periodRange('month', '2026-03-31', -1)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    // 30 октября 2026 — пятница.
    expect(periodRange('week', '2026-10-30')).toEqual({ from: '2026-10-26', to: '2026-11-01', short: '26 окт', title: '26 окт – 1 ноя' });
    expect(periodRange('week', '2026-11-01')).toMatchObject({ from: '2026-10-26' });
    expect(periodRange('week', '2026-10-30', -1)).toMatchObject({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange('year', '2026-10-30', -2)).toEqual({ from: '2024-01-01', to: '2024-12-31', short: '2024', title: '2024' });
  });
});

describe('курсы на день', () => {
  const book = new RateBook(
    [
      { day: '2026-10-01', currency: 'USD', rate: 80 },
      { day: '2026-10-15', currency: 'USD', rate: 90 },
      { day: '2026-10-01', currency: 'EUR', rate: 100 },
    ],
    { USDT: 82 },
  );
  it('последний не позже дня; раньше первого — первый; свой курс', () => {
    expect(book.rate('USD', '2026-10-14')).toBe(80);
    expect(book.rate('USD', '2026-10-15')).toBe(90);
    expect(book.rate('USD', '2026-12-01')).toBe(90);
    expect(book.rate('USD', '2026-01-01')).toBe(80);
    expect(book.rate('USDT', '2026-10-01')).toBe(82);
    expect(book.rate('XAU', '2026-10-01')).toBeNull();
    expect(book.convert(1000, 'USD', 'RUB', '2026-10-20')).toBe(90000);
    expect(book.convert(9000, 'RUB', 'USD', '2026-10-20')).toBe(100);
    expect(book.convert(1000, 'USD', 'EUR', '2026-10-02')).toBe(800);
  });

  it('чек делится по категориям позиций, копейки не теряются', () => {
    const op = { id: 'o', kind: 'expense', day: '2026-10-20', amount_minor: 1000, currency: 'USD', category_id: 'food' };
    const parts = spendParts(
      op,
      [
        { category_id: 'food', total_minor: 333 },
        { category_id: 'chem', total_minor: 333 },
        { category_id: null, total_minor: 334 },
      ],
      book,
      'RUB',
    );
    expect(parts).toEqual([
      { op_id: 'o', category_id: 'food', base_minor: 60030 },
      { op_id: 'o', category_id: 'chem', base_minor: 29970 },
    ]);
    expect(parts.reduce((s, p) => s + p.base_minor, 0)).toBe(90000);
    expect(spendParts(op, [], book, 'RUB')).toEqual([{ op_id: 'o', category_id: 'food', base_minor: 90000 }]);
    expect(spendParts({ ...op, currency: 'XAU' }, [], book, 'RUB')).toEqual([]);
  });
});

describe('цены из чеков', () => {
  const row = (name: string, day: string, total: number, extra: Partial<PriceRow> = {}): PriceRow => ({
    norm_name: name.toLowerCase(),
    name,
    qty: 1,
    unit: null,
    price_minor: null,
    total_minor: total,
    day,
    payee: 'Пятёрочка',
    currency: 'RUB',
    ...extra,
  });
  const rows = [
    row('Молоко', '2026-05-01', 7620),
    row('Молоко', '2026-10-01', 8990),
    row('Бананы', '2026-05-01', 16560, { qty: 1.2, unit: 'кг' }),
    row('Бананы', '2026-10-01', 12990, { qty: 1, unit: 'кг', price_minor: 12990 }),
    row('Хлеб', '2026-10-20', 6490),
    row('Яйца', '2026-08-01', 10990),
    row('Яйца', '2026-10-01', 11990),
  ];
  it('изменение цены за единицу; сильнее изменившиеся — выше', () => {
    const s = priceStats(rows);
    expect(s.map((p) => [p.name, p.change])).toEqual([
      ['Молоко', 18],
      ['Яйца', 9.1],
      ['Бананы', -5.9],
      ['Хлеб', null],
    ]);
    expect(s[2]).toMatchObject({ unit: 'кг', first: { price: 13800 }, last: { price: 12990 }, min: 12990, count: 2 });
    expect(priceStats(rows, 'мол').map((p) => p.name)).toEqual(['Молоко']);
    expect(priceHistory(rows, s[0].key).map((h) => h.unit_price)).toEqual([7620, 8990]);
  });
});
