import { describe, expect, it, vi } from 'vitest';
import { arrange, parseNav } from '@/lib/nav';
import type { Reminder } from '@/lib/types';

vi.mock('@/lib/db', () => ({ db: () => { throw new Error('нет базы в тесте'); } }));
const { icsFor, rrule } = await import('../calendar');

const rem = (over: Partial<Reminder>): Reminder => ({ id: 'r', title: 'Бассейн', times: ['18:30'], checklist_id: null, last_done: null, nag: null, tags: [], priority: 0, note: null, rule: { kind: 'repeat', unit: 'week', every: 1, start: '2026-09-01', weekdays: [2, 4] }, ...over });

describe('календарь (.ics)', () => {
  const ics = icsFor([rem({}), rem({ id: 'o', title: 'Паспорт', times: ['09:00'], rule: { kind: 'once', date: '2026-10-05' } })], '2026-10-02', new Date('2026-10-02T10:00:00Z'));
  it('разовая — в свой день и время', () => {
    expect(ics).toContain('UID:rem-o-20261005-0900@lifedashboard');
    expect(ics).toContain('DTSTART:20261005T090000');
  });
  it('повтор — одно событие с RRULE с первого раза, время плавающее', () => {
    expect(ics).toContain('DTSTART:20260901T183000'); // 1 сентября — вторник
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;WKST=MO');
    expect(ics.match(/UID:rem-r-/g)).toHaveLength(1);
  });
  it('правила → RRULE', () => {
    const start = '2026-01-31';
    expect(rrule({ kind: 'repeat', unit: 'day', every: 2, start })).toBe('RRULE:FREQ=DAILY;INTERVAL=2');
    expect(rrule({ kind: 'repeat', unit: 'month', every: 1, start })).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    expect(rrule({ kind: 'repeat', unit: 'month', every: 1, start, monthly: { type: 'nth', nth: 2, weekday: 6 } })).toBe('RRULE:FREQ=MONTHLY;BYDAY=2SA');
    expect(rrule({ kind: 'repeat', unit: 'month', every: 1, start, monthly: { type: 'day', day: -1 } })).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1');
    expect(rrule({ kind: 'repeat', unit: 'year', every: 1, start: '2024-02-29' })).toBe('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1');
    expect(rrule({ kind: 'repeat', unit: 'week', every: 1, start, weekdays: [1, 3], end: { type: 'until', date: '2026-12-31' } })).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO;UNTIL=20261231T235959');
    expect(rrule({ kind: 'repeat', unit: 'day', every: 1, start, end: { type: 'count', count: 5 } }, true)).toBe('RRULE:FREQ=DAILY;COUNT=5');
  });
  it('строки через CRLF и не длиннее 75 байт', () => {
    const long = icsFor([rem({ title: 'Очень длинное название дела '.repeat(6) })], '2026-10-02');
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(long.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });
  it('«после выполнения» — только следующий раз', () => {
    const one = icsFor([rem({ rule: { kind: 'after', unit: 'day', every: 4, start: '2026-09-01' }, last_done: '2026-09-30' })], '2026-10-02');
    expect(one.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(one).toContain('DTSTART:20261004T183000');
  });
});

describe('разделы меню', () => {
  it('по умолчанию — как было', () => {
    const a = arrange(null);
    expect(a.custom).toBe(false);
    expect(a.phone.map((s) => s.href)).toEqual(['/tasks', '/kitchen', '/workouts']);
  });
  it('свой порядок, скрытые, неизвестные отброшены, новые в конце', () => {
    const a = arrange([{ href: '/notes' }, { href: '/tasks', hidden: true }, { href: '/evil' }, { href: '/notes' }]);
    expect(a.all[0].href).toBe('/notes');
    expect(a.all).toHaveLength(5);
    expect(a.visible.some((s) => s.href === '/tasks')).toBe(false);
    expect(a.phone).toHaveLength(3);
    expect(parseNav('мусор')).toBeNull();
  });
});
