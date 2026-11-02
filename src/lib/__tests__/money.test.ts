import { describe, expect, it } from 'vitest';
import { formatMinor, money, parseAmount } from '../currencies';
import { convert, exchangeRate, matchesSearch, normItem, opEffect, quickParse, searchTerms } from '../money';
import { parseCbrJson, parseCbrXml } from '@/server/moneyRates';

describe('суммы', () => {
  it('разбирает запятую, точку и тысячи', () => {
    expect(parseAmount('350', 'RUB')).toBe(35000);
    expect(parseAmount('12,40', 'EUR')).toBe(1240);
    expect(parseAmount('12.4', 'EUR')).toBe(1240);
    expect(parseAmount('1 234,50', 'RUB')).toBe(123450);
    expect(parseAmount('1 234', 'RUB')).toBe(123400);
    expect(parseAmount('1.234,56', 'EUR')).toBe(123456);
    expect(parseAmount('1,234.56', 'USD')).toBe(123456);
    expect(parseAmount('1,234', 'USD')).toBe(123400);
    expect(parseAmount('1,234,567', 'RUB')).toBe(123456700);
  });
  it('учитывает знаки после запятой у валюты', () => {
    expect(parseAmount('1500', 'JPY')).toBe(1500);
    expect(parseAmount('1,5', 'JPY')).toBeNull();
    expect(parseAmount('0,001', 'BTC')).toBe(100000);
    expect(parseAmount('1,234', 'BHD')).toBe(1234);
  });
  it('не принимает мусор', () => {
    expect(parseAmount('', 'RUB')).toBeNull();
    expect(parseAmount('-5', 'RUB')).toBeNull();
    expect(parseAmount('12,345', 'RUB')).toBe(1234500);
    expect(parseAmount('12,3456', 'RUB')).toBeNull();
    expect(parseAmount('abc', 'RUB')).toBeNull();
  });
  it('показывает с пробелами и знаком валюты', () => {
    expect(formatMinor(123450, 'RUB')).toBe('1 234,50');
    expect(formatMinor(-500, 'USD')).toBe('−5,00');
    expect(formatMinor(1500, 'JPY')).toBe('1 500');
    expect(money(4025000, 'RUB', { trim: true })).toBe('40 250 ₽');
    expect(money(1240, 'EUR', { sign: true })).toBe('+12,40 €');
    expect(money(100, 'KZT')).toBe('1,00 ₸');
    expect(money(100, 'QAR')).toBe('1,00 QAR');
  });
});

describe('остатки и курсы', () => {
  const base = { amount_minor: 1000, to_account_id: null, to_amount_minor: null };
  it('расход и доход меняют свой счёт', () => {
    expect(opEffect({ ...base, kind: 'expense', account_id: 'a' }, 'a')).toBe(-1000);
    expect(opEffect({ ...base, kind: 'income', account_id: 'a' }, 'a')).toBe(1000);
    expect(opEffect({ ...base, kind: 'expense', account_id: 'a' }, 'b')).toBe(0);
  });
  it('обмен списывает с одного счёта и зачисляет на другой', () => {
    const op = { kind: 'exchange' as const, account_id: 'usd', amount_minor: 50000, to_account_id: 'rub', to_amount_minor: 4025000 };
    expect(opEffect(op, 'usd')).toBe(-50000);
    expect(opEffect(op, 'rub')).toBe(4025000);
  });
  it('переводит через рубль', () => {
    const rates: Record<string, number> = { USD: 81.6, EUR: 94.4, JPY: 0.55 };
    const rate = (c: string) => rates[c];
    expect(convert(1200, 'EUR', 'RUB', rate)).toBe(113280);
    expect(convert(10000, 'USD', 'EUR', rate)).toBe(Math.round((100 * 81.6 * 100) / 94.4));
    expect(convert(1000, 'JPY', 'RUB', rate)).toBe(55000);
    expect(convert(500, 'RUB', 'RUB', rate)).toBe(500);
    expect(convert(500, 'USDT', 'RUB', rate)).toBeNull();
  });
  it('считает курс обмена', () => {
    expect(exchangeRate(50000, 'USD', 4025000, 'RUB')).toBeCloseTo(80.5);
  });
});

describe('быстрый ввод', () => {
  it('сумма, название, валюта, день', () => {
    expect(quickParse('кофе 350', 'RUB')).toEqual({ title: 'Кофе', amount_minor: 35000, currency: null, days_ago: 0 });
    expect(quickParse('такси 12 € вчера', 'RUB')).toEqual({ title: 'Такси', amount_minor: 1200, currency: 'EUR', days_ago: 1 });
    expect(quickParse('$5 кофе', 'RUB')).toMatchObject({ title: 'Кофе', amount_minor: 500, currency: 'USD' });
    expect(quickParse('такси 12 евро позавчера', 'RUB')).toMatchObject({ currency: 'EUR', days_ago: 2 });
    expect(quickParse('продукты 1 200,50', 'RUB')).toMatchObject({ title: 'Продукты', amount_minor: 120050 });
    expect(quickParse('обед 450 руб', 'EUR')).toMatchObject({ currency: 'RUB', amount_minor: 45000 });
    expect(quickParse('подарок', 'RUB')).toMatchObject({ title: 'Подарок', amount_minor: null });
  });
});

describe('названия товаров', () => {
  it('без веса и процентов', () => {
    expect(normItem('Молоко 2,5% 930 мл')).toBe('молоко');
    expect(normItem('Сыр российский 200 г')).toBe('сыр российский');
    expect(normItem('Ёлка')).toBe('елка');
  });
});

describe('курсы ЦБ', () => {
  it('XML ЦБ: номинал и запятая', () => {
    const xml = `<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="30.10.2026" name="Foreign Currency Market">
      <Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>x</Name><Value>81,6000</Value></Valute>
      <Valute ID="R01820"><NumCode>392</NumCode><CharCode>JPY</CharCode><Nominal>100</Nominal><Name>x</Name><Value>55,0000</Value></Valute></ValCurs>`;
    const r = parseCbrXml(xml)!;
    expect(r.day).toBe('2026-10-30');
    expect(r.rates.USD).toBeCloseTo(81.6);
    expect(r.rates.JPY).toBeCloseTo(0.55);
    expect(parseCbrXml('<html>error</html>')).toBeNull();
  });
  it('зеркало в JSON', () => {
    const r = parseCbrJson({ Date: '2026-10-30T11:30:00+03:00', Valute: { EUR: { CharCode: 'EUR', Nominal: 1, Value: 94.4 }, KZT: { Nominal: 100, Value: 16.2 } } })!;
    expect(r.day).toBe('2026-10-30');
    expect(r.rates.EUR).toBe(94.4);
    expect(r.rates.KZT).toBeCloseTo(0.162);
    expect(parseCbrJson({})).toBeNull();
  });
});

describe('поиск по операциям и позициям чеков', () => {
  const hit = (q: string, text: string) => matchesSearch(text, searchTerms(q));
  it('«энергетики» находит сокращения и марки', () => {
    expect(hit('энергетики', 'Напиток энерг. Adrenaline Rush 0,449л')).toBe(true);
    expect(hit('энергетик', 'Энергетический напиток TORNADO')).toBe(true);
    expect(hit('Энергетики', 'Red Bull 0,25 ж/б')).toBe(true);
    expect(hit('энергетики', 'BURN Яблоко-киви 0.449')).toBe(true);
    expect(hit('энергетики', 'Молоко ПРОСТОКВАШИНО 2,5%')).toBe(false);
  });
  it('обычные слова — по началу, все слова запроса', () => {
    expect(hit('молоко', 'МОЛОКО ПАСТ. 3,2%')).toBe(true);
    expect(hit('кофе', 'Кофейня Шоколадница')).toBe(true);
    expect(hit('сыр', 'Колбаса сырокопч.')).toBe(true);
    expect(hit('молоко пармалат', 'Молоко Простоквашино')).toBe(false);
    expect(hit('ёлка', 'Елка искусственная')).toBe(true);
    expect(hit('', 'что угодно')).toBe(true);
  });
});
