import { describe, expect, it } from 'vitest';
import { formatMinor, money } from '../currencies';

describe('крупные итоги — в целых', () => {
  it('округляет до целых единиц валюты', () => {
    const nb = (s: string) => s.replace(/[  ]/g, ' ');
    expect(nb(money(29269836, 'RUB', { whole: true }))).toBe('292 698 ₽');
    expect(nb(money(938962, 'RUB', { whole: true }))).toBe('9 390 ₽');
    expect(nb(money(-11061038, 'RUB', { whole: true, sign: true }))).toBe('−110 610 ₽');
    expect(nb(money(5000, 'JPY', { whole: true }))).toBe('5 000 ¥');
    expect(formatMinor(49, 'USD', { whole: true })).toBe('0');
    // Без whole — как раньше.
    expect(nb(money(938962, 'RUB'))).toBe('9 389,62 ₽');
  });
});
