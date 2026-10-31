import { describe, expect, it } from 'vitest';
import { matches } from '../search';
import { quickActions } from '../quickActions';

describe('matches', () => {
  it('каждое слово — начало слова текста, ё = е', () => {
    expect(matches('Продукты · Пятёрочка', 'пятер')).toBe(true);
    expect(matches('Продукты · Пятёрочка', 'прод пят')).toBe(true);
    expect(matches('Продукты', 'дукт')).toBe(false);
    expect(matches('Что угодно', '')).toBe(false);
  });
});

describe('quickActions', () => {
  it('пусто — частые, без «Денег», если их нет', () => {
    expect(quickActions('', true).map((a) => a.id)).toContain('new-op');
    expect(quickActions('', false).map((a) => a.id)).not.toContain('new-op');
  });
  it('по названию — первыми, потом по другим словам', () => {
    const ids = quickActions('настр', true, 10).map((a) => a.id);
    expect(ids[0]).toBe('money-settings');
    expect(ids).toContain('settings');
    expect(ids).toContain('rhythm');
    expect(quickActions('тёмная', false).map((a) => a.id)).toEqual(['theme']);
    expect(quickActions('трата', true)[0].id).toBe('new-op');
  });
});
