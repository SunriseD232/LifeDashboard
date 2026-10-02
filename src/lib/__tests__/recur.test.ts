import { describe as group, expect, it } from 'vitest';
import { addMonths, describe, nextOccurrence, occursOn, parseRule, RuleError, type Rule } from '../recur';

/** Дни, когда дело бывает, в промежутке [from, to]. */
function days(rule: Rule, from: string, to: string, lastDone: string | null = null): string[] {
  const out: string[] = [];
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const x = d.toISOString().slice(0, 10);
    if (occursOn(rule, x, lastDone)) out.push(x);
  }
  return out;
}

group('once', () => {
  it('только в свой день', () => {
    expect(days({ kind: 'once', date: '2026-10-05' }, '2026-10-01', '2026-10-10')).toEqual(['2026-10-05']);
  });
});

group('repeat: дни', () => {
  it('каждые 3 дня со старта', () => {
    const r: Rule = { kind: 'repeat', unit: 'day', every: 3, start: '2026-10-02' };
    expect(days(r, '2026-09-25', '2026-10-12')).toEqual(['2026-10-02', '2026-10-05', '2026-10-08', '2026-10-11']);
  });
  it('через переход на зимнее время сутки не теряются', () => {
    const r: Rule = { kind: 'repeat', unit: 'day', every: 1, start: '2026-10-24' };
    expect(days(r, '2026-10-24', '2026-10-27')).toHaveLength(4);
  });
});

group('repeat: недели', () => {
  it('по будням', () => {
    const r: Rule = { kind: 'repeat', unit: 'week', every: 1, start: '2026-10-01', weekdays: [1, 2, 3, 4, 5] };
    // 2026-10-03 — суббота, 10-04 — воскресенье
    expect(days(r, '2026-10-01', '2026-10-06')).toEqual(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06']);
  });
  it('каждые 2 недели по вт и чт — считая от недели старта', () => {
    const r: Rule = { kind: 'repeat', unit: 'week', every: 2, start: '2026-10-01', weekdays: [2, 4] };
    // неделя 28.09–04.10: вт 29.09 раньше старта, чт 01.10; через неделю — пропуск; потом 13 и 15
    expect(days(r, '2026-09-28', '2026-10-18')).toEqual(['2026-10-01', '2026-10-13', '2026-10-15']);
  });
  it('без дней недели — в день недели старта', () => {
    const r: Rule = { kind: 'repeat', unit: 'week', every: 1, start: '2026-10-02' };
    expect(days(r, '2026-10-01', '2026-10-16')).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
  });
});

group('repeat: месяцы и годы', () => {
  it('31-го — в коротких месяцах последним днём', () => {
    const r: Rule = { kind: 'repeat', unit: 'month', every: 1, start: '2026-01-31', monthly: { type: 'day', day: 31 } };
    expect(nextOccurrence(r, '2026-02-01')).toBe('2026-02-28');
    expect(nextOccurrence(r, '2026-04-01')).toBe('2026-04-30');
  });
  it('в последний день месяца', () => {
    const r: Rule = { kind: 'repeat', unit: 'month', every: 1, start: '2026-01-01', monthly: { type: 'day', day: -1 } };
    expect(nextOccurrence(r, '2028-02-01')).toBe('2028-02-29');
  });
  it('вторая суббота и последняя пятница', () => {
    const sat: Rule = { kind: 'repeat', unit: 'month', every: 1, start: '2026-10-01', monthly: { type: 'nth', nth: 2, weekday: 6 } };
    expect(nextOccurrence(sat, '2026-10-01')).toBe('2026-10-10');
    const fri: Rule = { kind: 'repeat', unit: 'month', every: 1, start: '2026-10-01', monthly: { type: 'nth', nth: -1, weekday: 5 } };
    expect(nextOccurrence(fri, '2026-10-01')).toBe('2026-10-30');
  });
  it('каждые 3 месяца, 10-го', () => {
    const r: Rule = { kind: 'repeat', unit: 'month', every: 3, start: '2026-10-10', monthly: { type: 'day', day: 10 } };
    expect(nextOccurrence(r, '2026-10-11')).toBe('2027-01-10');
  });
  it('29 февраля — в обычный год 28-го', () => {
    const r: Rule = { kind: 'repeat', unit: 'year', every: 1, start: '2028-02-29' };
    expect(nextOccurrence(r, '2029-01-01')).toBe('2029-02-28');
  });
  it('addMonths прижимает к концу месяца', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

group('repeat: конец', () => {
  it('до даты', () => {
    const r: Rule = { kind: 'repeat', unit: 'day', every: 1, start: '2026-10-01', end: { type: 'until', date: '2026-10-03' } };
    expect(days(r, '2026-09-30', '2026-10-05')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(nextOccurrence(r, '2026-10-04')).toBeNull();
  });
  it('после N раз', () => {
    const r: Rule = { kind: 'repeat', unit: 'week', every: 1, start: '2026-10-05', weekdays: [1, 3], end: { type: 'count', count: 3 } };
    expect(days(r, '2026-10-01', '2026-10-31')).toEqual(['2026-10-05', '2026-10-07', '2026-10-12']);
    expect(nextOccurrence(r, '2026-10-13')).toBeNull();
  });
});

group('after: от выполнения', () => {
  const r: Rule = { kind: 'after', unit: 'day', every: 4, start: '2026-10-02' };
  it('первый раз — в старт, не сделали — висит каждый день', () => {
    expect(days(r, '2026-10-01', '2026-10-04')).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });
  it('сделали — следующий через 4 дня, а в день отметки дело остаётся', () => {
    expect(days(r, '2026-10-03', '2026-10-09', '2026-10-03')).toEqual(['2026-10-03', '2026-10-07', '2026-10-08', '2026-10-09']);
    expect(nextOccurrence(r, '2026-10-04', '2026-10-03')).toBe('2026-10-07');
  });
  it('раз в месяц после выполнения', () => {
    const m: Rule = { kind: 'after', unit: 'month', every: 1, start: '2026-10-01' };
    expect(nextOccurrence(m, '2026-10-02', '2026-01-31')).toBe('2026-10-02');
    expect(nextOccurrence(m, '2026-02-01', '2026-01-31')).toBe('2026-02-28');
  });
});

group('parseRule', () => {
  it('нормализует дни недели и отбрасывает лишнее', () => {
    expect(parseRule({ kind: 'repeat', unit: 'week', every: 1, start: '2026-10-01', weekdays: [5, 1, 1], junk: 1 })).toEqual({
      kind: 'repeat', unit: 'week', every: 1, start: '2026-10-01', weekdays: [1, 5],
    });
  });
  it('отклоняет неверное', () => {
    expect(() => parseRule({ kind: 'once', date: '2026-02-30' })).toThrow(RuleError);
    expect(() => parseRule({ kind: 'repeat', unit: 'day', every: 0, start: '2026-10-01' })).toThrow(RuleError);
    expect(() => parseRule({ kind: 'repeat', unit: 'day', every: 1, start: '2026-10-05', end: { type: 'until', date: '2026-10-01' } })).toThrow(RuleError);
    expect(() => parseRule({ kind: 'yearly' })).toThrow(RuleError);
  });
});

group('describe', () => {
  const start = '2026-10-01';
  it.each<[Rule, string]>([
    [{ kind: 'once', date: '2026-10-12' }, 'один раз, 12 октября'],
    [{ kind: 'repeat', unit: 'day', every: 1, start }, 'каждый день'],
    [{ kind: 'repeat', unit: 'day', every: 3, start }, 'каждые 3 дня'],
    [{ kind: 'repeat', unit: 'day', every: 21, start }, 'каждый 21 день'],
    [{ kind: 'repeat', unit: 'week', every: 1, start, weekdays: [1, 2, 3, 4, 5] }, 'по будням'],
    [{ kind: 'repeat', unit: 'week', every: 2, start, weekdays: [2, 4] }, 'каждые 2 недели по вт и чт'],
    [{ kind: 'repeat', unit: 'week', every: 1, start, weekdays: [0, 1] }, 'каждую неделю по пн и вс'],
    [{ kind: 'repeat', unit: 'month', every: 1, start, monthly: { type: 'day', day: 10 } }, 'каждый месяц, 10-го'],
    [{ kind: 'repeat', unit: 'month', every: 1, start, monthly: { type: 'nth', nth: 2, weekday: 6 } }, 'каждый месяц, во 2-ю субботу'],
    [{ kind: 'repeat', unit: 'month', every: 3, start, monthly: { type: 'nth', nth: -1, weekday: 1 } }, 'каждые 3 месяца, в последний понедельник'],
    [{ kind: 'repeat', unit: 'year', every: 1, start: '2026-03-15' }, 'каждый год, 15 марта'],
    [{ kind: 'repeat', unit: 'day', every: 1, start, end: { type: 'until', date: '2026-12-31' } }, 'каждый день, до 31 декабря'],
    [{ kind: 'repeat', unit: 'day', every: 1, start, end: { type: 'count', count: 5 } }, 'каждый день, 5 раз'],
    [{ kind: 'after', unit: 'day', every: 4, start }, 'через 4 дня после выполнения'],
    [{ kind: 'after', unit: 'month', every: 1, start }, 'через месяц после выполнения'],
  ])('%j → %s', (rule, text) => {
    expect(describe(rule)).toBe(text);
  });
});
