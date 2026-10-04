import { describe, expect, it } from 'vitest';
import type { Task } from '../tasks';
import { leftToday, timeline } from '../timeline';
import type { Reminder } from '../types';

const task = (over: Partial<Task>): Task => ({ id: Math.random().toString(36).slice(2), title: 'Дело', note: null, tag: null, due_date: null, rule: null, done_at: null, household_id: null, author: null, ...over });
const rem = (over: Partial<Reminder>): Reminder => ({ id: Math.random().toString(36).slice(2), title: 'Витамины', times: ['09:00'], checklist_id: null, last_done: null, nag: null, rule: { kind: 'repeat', unit: 'day', every: 1, start: '2026-10-01' }, ...over });
const today = '2026-10-04';

describe('«Дела» по дням', () => {
  const tasks = [
    task({ title: 'Страховка', due_date: '2026-10-03' }),
    task({ title: 'Отчёт', due_date: today }),
    task({ title: 'Врач' }),
    task({ title: 'Подарок', due_date: '2026-10-10' }),
    task({ title: 'Закрыто', due_date: today, done_at: today }),
  ];
  const reminders = [rem({ times: ['21:00', '09:00'] }), rem({ title: 'Стоматолог', times: ['11:00'], rule: { kind: 'once', date: '2026-10-08' } })];
  const g = timeline(tasks, reminders, today);
  const titles = (id: string) => g.find((x) => x.id === id)?.rows.map((r) => (r.kind === 'task' ? r.task.title : `${r.time} ${r.occ.reminder.title}`));

  it('группы по порядку и без пустых', () => {
    expect(g.map((x) => x.id)).toEqual(['overdue', 'today', 'tomorrow', 'later', 'none']);
  });
  it('сегодня: напоминания по времени, потом дела; закрытого нет', () => {
    expect(titles('today')).toEqual(['09:00 Витамины', '21:00 Витамины', 'Отчёт']);
    expect(titles('overdue')).toEqual(['Страховка']);
    expect(titles('none')).toEqual(['Врач']);
  });
  it('позже: дальние дела и разовые напоминания по датам, ежедневное — не разворачиваем', () => {
    expect(titles('later')).toEqual(['11:00 Стоматолог', 'Подарок']);
    expect(titles('tomorrow')).toEqual(['09:00 Витамины', '21:00 Витамины']);
  });
  it('осталось на сегодня', () => {
    expect(leftToday(g)).toBe(4);
    const done = timeline(tasks, reminders, today, new Set([`${reminders[0].id}@09:00`]));
    expect(leftToday(done)).toBe(3);
  });
  it('«после выполнения» — в ближайший раз, без повтора в «Завтра»', () => {
    const plants = rem({ title: 'Цветы', times: ['10:00'], rule: { kind: 'after', unit: 'day', every: 3, start: '2026-09-01' }, last_done: '2026-09-28' });
    const g2 = timeline([], [plants], today);
    expect(g2.map((x) => x.id)).toEqual(['today']);
    const soon = rem({ title: 'Цветы', times: ['10:00'], rule: { kind: 'after', unit: 'day', every: 3, start: '2026-09-01' }, last_done: '2026-10-02' });
    expect(timeline([], [soon], today).map((x) => x.id)).toEqual(['tomorrow']);
  });
});
