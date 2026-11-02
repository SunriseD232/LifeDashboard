import { describe, expect, it } from 'vitest';
import { fromNager, isDayOff, mergeWorkCalendar } from '../holidays';

describe('праздники', () => {
  it('Nager: только государственные по всей стране, название по-русски или по-английски', () => {
    const list = fromNager([
      { date: '2026-01-01', localName: 'Новый год', name: "New Year's Day", global: true, types: ['Public'] },
      { date: '2026-01-07', localName: 'შობა', name: 'Orthodox Christmas', global: true, types: ['Public'] },
      { date: '2026-03-17', localName: 'Местный', name: 'Regional', global: false, types: ['Public'] },
      { date: '2026-04-01', localName: 'Банковский', name: 'Bank', global: true, types: ['Bank'] },
      { date: 'плохо', localName: 'x' },
    ]);
    expect(list).toEqual([
      { day: '2026-01-01', name: 'Новый год', kind: 'holiday' },
      { day: '2026-01-07', name: 'Orthodox Christmas', kind: 'holiday' },
    ]);
    expect(fromNager('нет')).toEqual([]);
  });

  it('производственный календарь: перенесённый выходной, рабочая суббота, сокращённый день', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, days: '' }));
    // Январь 2026: 1 — праздник (чт), 9 — перенос (пт), 10 и 11 — обычные выходные;
    // 3 и 4 (сб, вс) не указаны — рабочие; 30* — сокращённый.
    months[0].days = '1,9+,10,11,30*';
    const out = mergeWorkCalendar(2026, [{ day: '2026-01-01', name: 'Новый год', kind: 'holiday' }], { months });
    const jan = out.filter((h) => h.day < '2026-01-31');
    expect(jan).toEqual([
      { day: '2026-01-01', name: 'Новый год', kind: 'holiday' },
      { day: '2026-01-03', name: 'Рабочий день (перенос)', kind: 'workday' },
      { day: '2026-01-04', name: 'Рабочий день (перенос)', kind: 'workday' },
      { day: '2026-01-09', name: 'Нерабочий день', kind: 'dayoff' },
      { day: '2026-01-17', name: 'Рабочий день (перенос)', kind: 'workday' },
      { day: '2026-01-18', name: 'Рабочий день (перенос)', kind: 'workday' },
      { day: '2026-01-24', name: 'Рабочий день (перенос)', kind: 'workday' },
      { day: '2026-01-25', name: 'Рабочий день (перенос)', kind: 'workday' },
      { day: '2026-01-30', name: 'Сокращённый день', kind: 'short' },
    ]);
    // Сломанный ответ — только праздники.
    const h = [{ day: '2026-01-01', name: 'Новый год', kind: 'holiday' as const }];
    expect(mergeWorkCalendar(2026, h, { months: [] })).toBe(h);
  });

  it('нерабочий день', () => {
    expect(isDayOff('2026-07-04', null)).toBe(true); // суббота
    expect(isDayOff('2026-07-06', null)).toBe(false);
    expect(isDayOff('2026-01-03', { day: '2026-01-03', name: 'x', kind: 'workday' })).toBe(false);
    expect(isDayOff('2026-01-09', { day: '2026-01-09', name: 'x', kind: 'dayoff' })).toBe(true);
    expect(isDayOff('2026-04-30', { day: '2026-04-30', name: 'x', kind: 'short' })).toBe(false);
  });
});
