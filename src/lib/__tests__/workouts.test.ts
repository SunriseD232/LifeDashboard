import { describe, expect, it } from 'vitest';
import { duration, lastTime, personalBest, plannedFor, recordSetIds, setLabel, tonnage, weeklyBest, type Workout } from '../workouts';

const w = (id: string, day: string, sets: [string, string, number | null, number][]): Workout => {
  const by = new Map<string, Workout['exercises'][number]>();
  for (const [sid, ex, weight, reps] of sets) {
    if (!by.has(ex)) by.set(ex, { id: `${id}-${ex}`, exercise_id: ex, sets: [] });
    by.get(ex)!.sets.push({ id: sid, weight, reps });
  }
  return { id, title: id, day, started_at: `${day} 16:00:00`, finished_at: `${day} 16:52:00`, note: null, template_id: null, exercises: [...by.values()] };
};

const history = [
  w('a', '2026-09-23', [['a1', 'bench', 60, 10], ['a2', 'bench', 65, 8], ['a3', 'pull', null, 8]]),
  w('b', '2026-09-30', [['b1', 'bench', 65, 8], ['b2', 'bench', 67.5, 6], ['b3', 'pull', null, 10]]),
  w('c', '2026-10-01', [['c1', 'bench', 70, 8], ['c2', 'bench', 72.5, 6]]),
];

describe('тренировки', () => {
  it('тоннаж без своего веса', () => {
    expect(tonnage(history[0])).toBe(600 + 520);
  });
  it('рекорды — лучше всего прежнего, первый подход не рекорд', () => {
    expect([...recordSetIds(history)].sort()).toEqual(['a2', 'b2', 'b3', 'c1', 'c2']);
  });
  it('прошлый раз — до этой тренировки', () => {
    const last = lastTime(history, 'bench', history[2]);
    expect(last?.day).toBe('2026-09-30');
    expect(last?.best).toEqual({ id: 'b2', weight: 67.5, reps: 6 });
    expect(lastTime(history, 'bench', history[0])).toBeNull();
  });
  it('лучший вес по неделям', () => {
    const wk = weeklyBest(history, 'bench', '2026-10-02', 3);
    expect(wk).toEqual([
      { week: '2026-09-14', weight: null },
      { week: '2026-09-21', weight: 65 },
      { week: '2026-09-28', weight: 72.5 },
    ]);
  });
  it('рекорд за всё время и подписи', () => {
    expect(personalBest(history, 'bench')).toEqual({ id: 'c2', weight: 72.5, reps: 6 });
    expect(setLabel({ weight: 72.5, reps: 6 })).toBe('72,5 кг × 6');
    expect(setLabel({ weight: null, reps: 10 })).toBe('свой вес × 10');
  });
  it('длительность', () => {
    expect(duration('2026-10-01 16:00:00', '2026-10-01 16:52:00')).toBe('52 мин');
    expect(duration('2026-10-01 16:00:00', '2026-10-01 17:05:00')).toBe('1 ч 05 мин');
  });
  it('план на день недели', () => {
    const t = [{ id: 'legs', title: 'Ноги', weekdays: [1, 4], plan: [] }];
    expect(plannedFor(t, '2026-10-05')?.id).toBe('legs');
    expect(plannedFor(t, '2026-10-06')).toBeNull();
  });
});
