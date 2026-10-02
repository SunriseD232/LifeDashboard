import { describe, expect, it, vi } from 'vitest';
import { arrange, parseNav } from '@/lib/nav';
import type { Task } from '@/lib/tasks';
import type { Reminder } from '@/lib/types';

vi.mock('@/lib/db', () => ({ db: () => { throw new Error('нет базы в тесте'); } }));
const { icsFor, rrule } = await import('../calendar');

const task = (over: Partial<Task>): Task => ({ id: 't', title: 'Оплатить свет', note: null, tag: null, due_date: '2026-10-05', rule: null, done_at: null, household_id: null, author: null, ...over });
const rem = (over: Partial<Reminder>): Reminder => ({ id: 'r', title: 'Бассейн', times: ['18:30'], checklist_id: null, last_done: null, nag: null, rule: { kind: 'repeat', unit: 'week', every: 1, start: '2026-09-01', weekdays: [2, 4] }, ...over });

describe('календарь (.ics)', () => {
  const ics = icsFor([task({}), task({ id: 'd', done_at: '2026-10-01' }), task({ id: 'n', due_date: null })], [rem({})], '2026-10-02', new Date('2026-10-02T10:00:00Z'));
  it('дело со сроком — на весь день, закрытые и без даты — нет', () => {
    expect(ics).toContain('UID:task-t@lifedashboard');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005');
    expect(ics).not.toContain('task-d@');
    expect(ics).not.toContain('task-n@');
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
    const long = icsFor([task({ title: 'Очень длинное название дела '.repeat(6) })], [], '2026-10-02');
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(long.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });
  it('«после выполнения» — только следующий раз', () => {
    const one = icsFor([], [rem({ rule: { kind: 'after', unit: 'day', every: 4, start: '2026-09-01' }, last_done: '2026-09-30' })], '2026-10-02');
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
    expect(a.all).toHaveLength(7);
    expect(a.visible.some((s) => s.href === '/tasks')).toBe(false);
    expect(a.phone).toHaveLength(3);
    expect(parseNav('мусор')).toBeNull();
  });
});
