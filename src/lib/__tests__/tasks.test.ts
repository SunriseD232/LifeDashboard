import { describe, expect, it } from 'vitest';
import { bucket, deadlineNotices, dueLabel, firstDue, groupLater, laterGroup, nextDue, sortUrgent } from '../tasks';

// 2026-10-02 — пятница
const today = '2026-10-02';

describe('bucket', () => {
  it('без даты и до завтра включительно — срочно, дальше — позже', () => {
    expect(bucket({ done_at: null, due_date: null }, today)).toBe('urgent');
    expect(bucket({ done_at: null, due_date: '2026-09-28' }, today)).toBe('urgent');
    expect(bucket({ done_at: null, due_date: '2026-10-03' }, today)).toBe('urgent');
    expect(bucket({ done_at: null, due_date: '2026-10-04' }, today)).toBe('later');
    expect(bucket({ done_at: today, due_date: null }, today)).toBe('done');
  });
});

describe('dueLabel', () => {
  it.each([
    ['2026-09-30', 'просрочено на 2 дня', 'danger'],
    ['2026-10-01', 'просрочено на 1 день', 'danger'],
    [today, 'сегодня', 'danger'],
    ['2026-10-03', 'завтра', 'warm'],
    ['2026-10-06', 'вт 6', 'muted'],
    ['2026-10-20', '20 октября', 'muted'],
  ])('%s → %s', (due, text, tone) => {
    expect(dueLabel(due, today)).toEqual({ text, tone });
  });
});

describe('laterGroup', () => {
  it.each([
    ['2026-10-04', 'На этой неделе'],
    ['2026-10-06', 'На следующей неделе'],
    ['2026-10-11', 'На следующей неделе'],
    ['2026-10-20', 'Позже в октябре'],
    ['2026-11-03', 'В ноябре'],
    ['2027-01-10', 'В январе'],
    ['2027-09-01', 'Позже'],
  ])('%s → %s', (due, group) => {
    expect(laterGroup(due, today)).toBe(group);
  });
  it('groupLater сортирует и склеивает подряд', () => {
    const g = groupLater([{ due_date: '2026-10-20' }, { due_date: '2026-10-07' }, { due_date: '2026-10-06' }], today);
    expect(g.map((x) => [x.title, x.tasks.length])).toEqual([
      ['На следующей неделе', 2],
      ['Позже в октябре', 1],
    ]);
  });
});

describe('sortUrgent', () => {
  it('сначала со сроком по порядку, потом без даты', () => {
    const s = sortUrgent([
      { title: 'a', due_date: null },
      { title: 'b', due_date: '2026-10-03' },
      { title: 'c', due_date: '2026-09-30' },
    ]);
    expect(s.map((t) => t.title)).toEqual(['c', 'b', 'a']);
  });
});

describe('повторяющиеся дела', () => {
  const mondays = { kind: 'repeat' as const, unit: 'week' as const, every: 1, start: '2026-09-01', weekdays: [1] };
  it('первый срок — ближайший подходящий день', () => {
    expect(firstDue(mondays, today)).toBe('2026-10-05');
  });
  it('выполнили в срок — следующий понедельник', () => {
    expect(nextDue(mondays, '2026-10-05', '2026-10-05')).toBe('2026-10-12');
  });
  it('выполнили заранее — следующий после срока', () => {
    expect(nextDue(mondays, '2026-10-05', '2026-10-02')).toBe('2026-10-12');
  });
  it('просрочили — следующий после дня выполнения', () => {
    expect(nextDue(mondays, '2026-09-28', '2026-10-07')).toBe('2026-10-12');
  });
  it('после выполнения — от дня отметки', () => {
    expect(nextDue({ kind: 'after', unit: 'day', every: 10, start: today }, today, '2026-10-04')).toBe('2026-10-14');
  });
  it('повторы кончились — null', () => {
    expect(nextDue({ kind: 'repeat', unit: 'day', every: 1, start: today, end: { type: 'count', count: 1 } }, today, today)).toBeNull();
  });
});

describe('deadlineNotices', () => {
  const tasks = [
    { id: 'a', due_date: today, done_at: null },
    { id: 'b', due_date: '2026-10-03', done_at: null },
    { id: 'c', due_date: '2026-10-05', done_at: null },
    { id: 'd', due_date: today, done_at: today },
  ];
  it('в своё время — сегодня и завтра, сделанные не трогаем', () => {
    expect(deadlineNotices(tasks, today, 9 * 60 + 2, '09:00').map((n) => [n.task.id, n.kind])).toEqual([
      ['a', 'today'],
      ['b', 'tomorrow'],
    ]);
  });
  it('не в своё время — ничего', () => {
    expect(deadlineNotices(tasks, today, 8 * 60, '09:00')).toEqual([]);
  });
});
