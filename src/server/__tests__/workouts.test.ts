import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { workoutExercises, workouts, workoutSets, workoutTemplates } from '../api/workouts';
import type { Ctx } from '../http';
import { readExercises, readTemplates, readWorkouts } from '../workoutStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'other'].forEach((u) => user.run(u, u));
  return d;
}

const call = (fn: (c: Ctx) => unknown, d: Database.Database, userId: string, method: string, path: (string | undefined)[], body: Record<string, unknown> = {}) =>
  fn({ d, userId, method, body, id: path[0], action: path[1] } as unknown as Ctx) as never;

describe('тренировки на сервере', () => {
  it('тренировка → упражнения → подходы → шаблон → по шаблону', () => {
    const d = setup();
    const { id: wid } = call(workouts, d, 'me', 'POST', [], { day: '2026-10-01', title: 'Грудь и спина' }) as { id: string };
    const { id: bench } = call(workouts, d, 'me', 'POST', [wid, 'exercises'], { name: 'жим штанги лёжа' }) as { id: string };
    call(workoutExercises, d, 'me', 'POST', [bench, 'sets'], { weight: 70, reps: 8 });
    call(workoutExercises, d, 'me', 'POST', [bench, 'sets'], { weight: '72.5', reps: 6 });
    const { id: pull } = call(workouts, d, 'me', 'POST', [wid, 'exercises'], { name: 'Подтягивания' }) as { id: string };
    call(workoutExercises, d, 'me', 'POST', [pull, 'sets'], { weight: null, reps: 10 });

    const w = readWorkouts(d, 'me')[0];
    expect(w.exercises.map((e) => e.sets.map((s) => [s.weight, s.reps]))).toEqual([
      [
        [70, 8],
        [72.5, 6],
      ],
      [[null, 10]],
    ]);
    // То же упражнение, как ни напиши: без дублей, с заглавной буквы.
    call(workouts, d, 'me', 'POST', [wid, 'exercises'], { name: 'Жим штанги лёжа' });
    call(workouts, d, 'me', 'POST', [wid, 'exercises'], { name: 'ЖИМ  ШТАНГИ ЛЕЖА' });
    expect(readExercises(d, 'me').map((e) => e.name)).toEqual(['Жим штанги лёжа', 'Подтягивания']);

    const { id: tid } = call(workoutTemplates, d, 'me', 'POST', [], { from_workout: wid, weekdays: [3, 1] }) as { id: string };
    expect(readTemplates(d, 'me')[0]).toMatchObject({ title: 'Грудь и спина', weekdays: [1, 3] });
    expect(readTemplates(d, 'me')[0].plan[0]).toMatchObject({ sets: 2, reps: 6, weight: 72.5 });

    const { id: w2 } = call(workouts, d, 'me', 'POST', [], { day: '2026-10-05', template_id: tid }) as { id: string };
    const next = readWorkouts(d, 'me').find((x) => x.id === w2)!;
    expect(next.title).toBe('Грудь и спина');
    expect(next.exercises.length).toBe(4);
  });

  it('завершить и вернуть; правка и удаление подхода', () => {
    const d = setup();
    const { id: wid } = call(workouts, d, 'me', 'POST', [], { day: '2026-10-01' }) as { id: string };
    call(workouts, d, 'me', 'PATCH', [wid], { finished: true });
    expect(readWorkouts(d, 'me')[0].finished_at).not.toBeNull();
    const { id: we } = call(workouts, d, 'me', 'POST', [wid, 'exercises'], { name: 'Присед' }) as { id: string };
    const { id: s } = call(workoutExercises, d, 'me', 'POST', [we, 'sets'], { weight: 90, reps: 6 }) as { id: string };
    call(workoutSets, d, 'me', 'PATCH', [s], { reps: 7 });
    expect(readWorkouts(d, 'me')[0].exercises[0].sets[0].reps).toBe(7);
    call(workoutSets, d, 'me', 'DELETE', [s]);
    expect(readWorkouts(d, 'me')[0].exercises[0].sets).toEqual([]);
  });

  it('чужое не трогается и неверное не принимается', () => {
    const d = setup();
    const { id: wid } = call(workouts, d, 'me', 'POST', [], { day: '2026-10-01' }) as { id: string };
    const { id: we } = call(workouts, d, 'me', 'POST', [wid, 'exercises'], { name: 'Присед' }) as { id: string };
    expect(() => call(workouts, d, 'other', 'DELETE', [wid])).toThrow(/не найдена/);
    expect(() => call(workoutExercises, d, 'other', 'POST', [we, 'sets'], { weight: 1, reps: 1 })).toThrow(/не найдено/);
    expect(() => call(workoutExercises, d, 'me', 'POST', [we, 'sets'], { weight: 50, reps: 0 })).toThrow(/Повторы/);
    expect(readWorkouts(d, 'other')).toEqual([]);
  });
});
