import { describe, expect, it } from 'vitest';
import { detectRecurring, dueDates, monthlyNeed, nextDate } from '../moneyPlans';
import { parseBankSms } from '../moneySms';

describe('регулярные платежи', () => {
  it('следующая дата держится за число месяца', () => {
    expect(nextDate('2026-01-31', 'month', 1, 31)).toBe('2026-02-28');
    expect(nextDate('2026-02-28', 'month', 1, 31)).toBe('2026-03-31');
    expect(nextDate('2028-01-31', 'month', 1, 31)).toBe('2028-02-29');
    expect(nextDate('2026-10-30', 'week', 2, 30)).toBe('2026-11-13');
    expect(nextDate('2026-10-30', 'year', 1, 30)).toBe('2027-10-30');
    expect(nextDate('2026-11-15', 'month', 3, 15)).toBe('2027-02-15');
  });
  it('пропущенные даты — все, что уже наступили', () => {
    expect(dueDates('2026-08-05', '2026-10-30', 'month', 1, 5)).toEqual({ due: ['2026-08-05', '2026-09-05', '2026-10-05'], next: '2026-11-05' });
    expect(dueDates('2026-11-05', '2026-10-30', 'month', 1, 5)).toEqual({ due: [], next: '2026-11-05' });
  });
  it('поиск подписок в истории', () => {
    const op = (day: string, payee: string, amount: number, kind = 'expense') => ({ kind, day, payee, account_id: 'a', category_id: 'c', amount_minor: amount, currency: 'RUB' });
    const ops = [
      op('2026-07-02', 'Spotify', 29900),
      op('2026-08-02', 'Spotify', 29900),
      op('2026-09-02', 'Spotify', 29900),
      op('2026-10-02', 'spotify', 29900),
      op('2026-08-10', 'Пятёрочка', 120000),
      op('2026-08-12', 'Пятёрочка', 50000),
      op('2026-09-01', 'Пятёрочка', 90000),
      op('2026-08-05', 'Зарплата', 15000000, 'income'),
      op('2026-09-05', 'Зарплата', 15500000, 'income'),
      op('2026-10-05', 'Зарплата', 15000000, 'income'),
      op('2026-08-01', 'Интернет', 75000),
      op('2026-09-01', 'Интернет', 75000),
      op('2026-10-01', 'Интернет', 75000),
    ];
    const r = detectRecurring(ops, ['интернет']);
    expect(r.map((c) => [c.payee, c.kind, c.unit, c.next_day])).toEqual([
      ['spotify', 'expense', 'month', '2026-11-02'],
      ['Зарплата', 'income', 'month', '2026-11-05'],
    ]);
  });
  it('сколько откладывать в месяц', () => {
    expect(monthlyNeed(120000, '2026-10-30', '2027-04-01')).toBe(20000);
    expect(monthlyNeed(100, '2026-10-30', '2026-11-05')).toBe(100);
    expect(monthlyNeed(0, '2026-10-30', '2027-01-01')).toBeNull();
    expect(monthlyNeed(100, '2026-10-30', null)).toBeNull();
  });
});

describe('SMS банков', () => {
  const cases: [string, Partial<ReturnType<typeof parseBankSms>> | null][] = [
    ['MIR-1435 20:16 Покупка 3340.51р PEREKRESTOK Баланс: 12345.67р', { kind: 'expense', amount: 3340.51, currency: 'RUB', payee: 'Perekrestok', card_last4: '1435' }],
    ['ECMC1234 30.10.26 21:15 покупка 350р KOFEMANIYA Баланс: 9 880р', { kind: 'expense', amount: 350, payee: 'Kofemaniya', card_last4: '1234' }],
    ['Покупка, карта *1234. 1 477,60 RUB. PYATEROCHKA 1234. Доступно 12 345 RUB', { kind: 'expense', amount: 1477.6, currency: 'RUB', payee: 'Pyaterochka 1234', card_last4: '1234' }],
    ['Пополнение, счет RUB. 120 000 RUB. ООО Ромашка. Доступно 132 345 RUB', { kind: 'income', amount: 120000, payee: 'ООО Ромашка' }],
    ['СЧЁТ1234 30.10 зачисление зарплаты 150000р Баланс: 162345.67р', { kind: 'income', amount: 150000, card_last4: '1234' }],
    ['Списание 750.00р Счет*5678 ROSTELECOM Баланс 11595.67р 09:10', { kind: 'expense', amount: 750, payee: 'Rostelecom', card_last4: '5678' }],
    ['Purchase 12.40 EUR at ALBERT HEIJN 1234, card *9876. Available 980.10 EUR', { kind: 'expense', amount: 12.4, currency: 'EUR', card_last4: '9876' }],
    ['Оплата $5.99 Spotify карта *4321', { kind: 'expense', amount: 5.99, currency: 'USD', card_last4: '4321' }],
    ['Код подтверждения: 1234. Никому не сообщайте. Покупка 500р', null],
    ['Отказ: недостаточно средств. Покупка 900р KOFE', null],
    ['Скидка 20% на всё в Пятёрочке!', null],
    ['MIR-1435 14:06 Отмена покупки 1р YANDEX.GO Баланс: 12345.67р', { kind: 'income', amount: 1, refund: true }],
    ['Возврат 1 RUB, карта *1234. OZON. Доступно 500 RUB', { kind: 'income', amount: 1, refund: true }],
    ['MIR-1435 14:06 Покупка 1р YANDEX.GO Баланс: 12344.67р', { kind: 'expense', amount: 1, refund: false }],
  ];
  for (const [sms, want] of cases) {
    it(sms.slice(0, 40), () => {
      const r = parseBankSms(sms);
      if (want === null) expect(r).toBeNull();
      else expect(r).toMatchObject(want);
    });
  }
});
