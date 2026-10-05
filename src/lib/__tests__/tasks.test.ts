import { describe, expect, it } from 'vitest';
import { cleanTags, isPriority, knownTags, shortDate } from '../tasks';

describe('метки', () => {
  it('чистка: пробелы, повторы без учёта регистра, длина, не больше 10', () => {
    expect(cleanTags([' дом ', 'Дом', 'работа', '', 5, 'очень   длинная'])).toEqual(['дом', 'работа', 'очень длинная']);
    expect(cleanTags(Array.from({ length: 15 }, (_, i) => `м${i}`))).toHaveLength(10);
    expect(cleanTags('дом')).toEqual([]);
  });
  it('свои по порядку, потом встреченные у задач — по алфавиту', () => {
    expect(knownTags(['работа', 'дом'], [{ tags: ['Дом', 'дача'] }], [{ tags: ['авто'] }])).toEqual(['работа', 'дом', 'авто', 'дача']);
  });
});

describe('важность', () => {
  it('только 0–3', () => {
    expect([0, 1, 2, 3].every(isPriority)).toBe(true);
    expect(isPriority(4)).toBe(false);
    expect(isPriority('3')).toBe(false);
  });
});

describe('короткая дата', () => {
  it.each([
    ['2026-10-06', 'вт 6'],
    ['2026-10-20', '20 окт'],
    ['2026-09-30', '30 сен'],
  ])('%s → %s', (day, text) => expect(shortDate(day, '2026-10-02')).toBe(text));
});
