import { describe, expect, it, vi } from 'vitest';
import { arrange, parseNav } from '@/lib/nav';
import type { Task } from '@/lib/tasks';
import type { Reminder } from '@/lib/types';

vi.mock('@/lib/db', () => ({ db: () => { throw new Error('нет базы в тесте'); } }));
const { icsFor } = await import('../calendar');

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
  it('напоминание — на свои дни и время, плавающее', () => {
    expect(ics).toContain('DTSTART:20261006T183000'); // вторник
    expect(ics).toContain('DTSTART:20261008T183000'); // четверг
    expect(ics).not.toContain('DTSTART:20261007T183000');
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
    expect(a.all).toHaveLength(6);
    expect(a.visible.some((s) => s.href === '/tasks')).toBe(false);
    expect(a.phone).toHaveLength(3);
    expect(parseNav('мусор')).toBeNull();
  });
});
