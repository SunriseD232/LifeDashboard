import { describe, expect, it } from 'vitest';
import { daysInYear, overlaps, pausedOn, spanDays, vacationOn, yearCount, type Vacation } from '../vacations';

const v = (id: string, start: string, end: string, pause = true): Vacation => ({ id, title: 'Отпуск', start, end, pause });

describe('vacations', () => {
  it('counts calendar days inclusively', () => {
    expect(spanDays('2026-07-01', '2026-07-14')).toBe(14);
    expect(spanDays('2026-07-01', '2026-07-01')).toBe(1);
    expect(spanDays('2026-07-02', '2026-07-01')).toBe(0);
    // через смену времени и високосный февраль
    expect(spanDays('2028-02-27', '2028-03-01')).toBe(4);
  });

  it('splits a vacation across New Year', () => {
    const nye = v('a', '2026-12-28', '2027-01-04');
    expect(daysInYear(nye, 2026)).toBe(4);
    expect(daysInYear(nye, 2027)).toBe(4);
    expect(daysInYear(nye, 2025)).toBe(0);
  });

  it('finds the vacation of a day and the pause', () => {
    const list = [v('a', '2026-07-01', '2026-07-14'), v('b', '2026-08-01', '2026-08-03', false)];
    expect(vacationOn(list, '2026-07-14')?.id).toBe('a');
    expect(vacationOn(list, '2026-07-15')).toBeNull();
    expect(pausedOn(list, '2026-07-05')).toBe(true);
    expect(pausedOn(list, '2026-08-02')).toBe(false);
  });

  it('splits taken and planned around today', () => {
    const list = [v('a', '2026-07-01', '2026-07-14'), v('b', '2026-11-01', '2026-11-10'), v('c', '2026-12-30', '2027-01-08')];
    expect(yearCount(list, 2026, '2026-11-03', 28)).toEqual({ taken: 17, planned: 7 + 2, left: 28 - 17 - 9 });
    expect(yearCount(list, 2026, '2026-11-03', null).left).toBeNull();
  });

  it('detects overlaps, except itself', () => {
    const list = [v('a', '2026-07-01', '2026-07-14')];
    expect(overlaps(list, '2026-07-14', '2026-07-20')?.id).toBe('a');
    expect(overlaps(list, '2026-07-15', '2026-07-20')).toBeNull();
    expect(overlaps(list, '2026-07-01', '2026-07-20', 'a')).toBeNull();
  });
});
