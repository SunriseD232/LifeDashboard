import { describe, expect, it } from 'vitest';
import { agendaFor, monthGrid } from '../agenda';
import type { Task } from '../tasks';
import type { Reminder } from '../types';

const task = (over: Partial<Task>): Task => ({ id: 't', title: 'Дело', note: null, tag: null, due_date: '2026-10-05', rule: null, done_at: null, household_id: null, author: null, ...over });
const rem = (over: Partial<Reminder>): Reminder => ({ id: 'r', title: 'Бассейн', times: ['18:30'], checklist_id: null, last_done: null, nag: null, rule: { kind: 'repeat', unit: 'week', every: 1, start: '2026-09-01', weekdays: [2, 4] }, ...over });
const today = '2026-10-03';

describe('календарь: что на день', () => {
  it('дело в свой срок, повторяющееся — и в будущие разы', () => {
    const weekly = task({ id: 'w', due_date: '2026-10-05', rule: { kind: 'repeat', unit: 'week', every: 1, start: '2026-01-05' } });
    expect(agendaFor('2026-10-05', [task({}), weekly], [], today)).toHaveLength(2);
    expect(agendaFor('2026-10-12', [weekly], [], today)).toHaveLength(1);
    expect(agendaFor('2026-10-13', [weekly], [], today)).toHaveLength(0);
    expect(agendaFor('2026-10-05', [task({ done_at: '2026-10-02' })], [], today)).toHaveLength(0);
  });
  it('напоминание по правилу, с временем; «после выполнения» — только ближайший раз', () => {
    expect(agendaFor('2026-10-06', [], [rem({})], today).map((i) => i.time)).toEqual(['18:30']);
    expect(agendaFor('2026-10-07', [], [rem({})], today)).toHaveLength(0);
    const after = rem({ id: 'a', rule: { kind: 'after', unit: 'day', every: 3, start: '2026-09-01' }, last_done: '2026-10-02' });
    expect(agendaFor('2026-10-05', [], [after], today)).toHaveLength(1);
    expect(agendaFor('2026-10-08', [], [after], today)).toHaveLength(0);
  });
  it('сетка месяца с понедельника', () => {
    const g = monthGrid('2026-10-01');
    expect(g[0][0]).toBe('2026-09-28');
    expect(g[0][3]).toBe('2026-10-01');
    expect(g.length).toBe(5);
    expect(g.flat()).toContain('2026-10-31');
  });
});
