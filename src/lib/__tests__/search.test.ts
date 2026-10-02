import { describe, expect, it } from 'vitest';
import { normalize, splitSnippet, toMatch } from '../search';

describe('toMatch', () => {
  it('каждое слово — по началу, все обязательны', () => {
    expect(toMatch('Бассейн расписание')).toBe('"бассейн"* "расписание"*');
  });
  it('ё → е и выброс служебных символов', () => {
    expect(toMatch('Ёлка "OR" -x*')).toBe('"елка"* "or"* "x"*');
  });
  it('пустой ввод', () => {
    expect(toMatch('  ;; ')).toBeNull();
  });
});

describe('splitSnippet', () => {
  it('режет по меткам совпадений', () => {
    expect(splitSnippet('Расписание \u0001бассейна\u0002 по вт')).toEqual([
      { text: 'Расписание ', hit: false },
      { text: 'бассейна', hit: true },
      { text: ' по вт', hit: false },
    ]);
  });
  it('normalize', () => {
    expect(normalize('Ещё Ёж')).toBe('Еще Еж');
  });
});
