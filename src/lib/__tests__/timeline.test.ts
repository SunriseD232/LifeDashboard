import { describe, expect, it } from 'vitest';
import type { Task } from '../tasks';
import { isOverdue, leftToday, timeline } from '../timeline';
import type { Reminder } from '../types';

const task = (over: Partial<Task>): Task => ({ id: Math.random().toString(36).slice(2), title: 'Задача', note: null, tags: [], priority: 0, checklist_id: null, done_at: null, household_id: null, author: null, ...over });
const rem = (over: Partial<Reminder>): Reminder => ({ id: Math.random().toString(36).slice(2), title: 'Витамины', times: ['09:00'], checklist_id: null, last_done: null, nag: null, tags: [], priority: 0, note: null, rule: { kind: 'repeat', unit: 'day', every: 1, start: '2026-10-01' }, ...over });
const today = '2026-10-04';

describe('«Задачи» по дням', () => {
  const tasks = [task({ title: 'Врач' }), task({ title: 'Срочное', priority: 3 }), task({ title: 'Закрыто', done_at: today })];
  const reminders = [
    rem({ times: ['21:00', '09:00'] }),
    rem({ title: 'Стоматолог', times: ['11:00'], rule: { kind: 'once', date: '2026-10-08' } }),
    rem({ title: 'Страховка', times: ['10:00'], rule: { kind: 'once', date: '2026-10-02' } }),
    rem({ title: 'Сделано вчера', times: ['10:00'], rule: { kind: 'once', date: '2026-10-03' }, last_done: '2026-10-03' }),
  ];
  const g = timeline(tasks, reminders, today);
  const titles = (id: string) => g.find((x) => x.id === id)?.rows.map((r) => (r.kind === 'task' ? r.task.title : `${r.time} ${r.occ.reminder.title}`));

  it('группы по порядку и без пустых', () => {
    expect(g.map((x) => x.id)).toEqual(['overdue', 'today', 'tomorrow', 'later', 'none']);
  });
  it('просрочено — разовые прошлых дней без отметки', () => {
    expect(titles('overdue')).toEqual(['10:00 Страховка']);
    expect(isOverdue(reminders[3], today)).toBe(false);
  });
  it('сегодня — по времени; без напоминания — важные сверху, закрытых нет', () => {
    expect(titles('today')).toEqual(['09:00 Витамины', '21:00 Витамины']);
    expect(titles('none')).toEqual(['Срочное', 'Врач']);
  });
  it('позже: разовые по датам, ежедневное — не разворачиваем', () => {
    expect(titles('later')).toEqual(['11:00 Стоматолог']);
    expect(titles('tomorrow')).toEqual(['09:00 Витамины', '21:00 Витамины']);
  });
  it('разовая, сделанная заранее, из «Позже» уходит', () => {
    const early = rem({ title: 'Заранее', rule: { kind: 'once', date: '2026-10-09' }, last_done: today });
    expect(timeline([], [early], today)).toEqual([]);
  });
  it('осталось на сегодня', () => {
    expect(leftToday(g)).toBe(3);
    const done = timeline(tasks, reminders, today, new Set([`${reminders[0].id}@09:00`]));
    expect(leftToday(done)).toBe(2);
  });
  it('«после выполнения» — в ближайший раз, без повтора в «Завтра»', () => {
    const plants = rem({ title: 'Цветы', times: ['10:00'], rule: { kind: 'after', unit: 'day', every: 3, start: '2026-09-01' }, last_done: '2026-09-28' });
    expect(timeline([], [plants], today).map((x) => x.id)).toEqual(['today']);
    const soon = rem({ title: 'Цветы', times: ['10:00'], rule: { kind: 'after', unit: 'day', every: 3, start: '2026-09-01' }, last_done: '2026-10-02' });
    expect(timeline([], [soon], today).map((x) => x.id)).toEqual(['tomorrow']);
  });
});
