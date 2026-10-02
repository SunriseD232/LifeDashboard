import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { normName } from '@/lib/kitchen';
import type { Exercise, Workout, WorkoutTemplate } from '@/lib/workouts';

/**
 * Тренировки из базы — личные, только свои. История на экран — последние
 * HISTORY тренировок: рекорды и графики считаются по ним (это несколько лет
 * при трёх тренировках в неделю).
 */
export const HISTORY = 300;

export function readExercises(d: Database.Database, userId: string): Exercise[] {
  return d.prepare('select id, name from exercises where user_id = ? order by name').all(userId) as Exercise[];
}

/**
 * Упражнение по названию (без учёта регистра, «ё» = «е»); нет — заводим.
 * Сравниваем в коде: lower() в SQLite не знает кириллицы.
 */
export function exerciseByName(d: Database.Database, userId: string, name: string): Exercise {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80);
  const key = normName(clean);
  const found = readExercises(d, userId).find((e) => normName(e.name) === key);
  if (found) return found;
  const e = { id: randomUUID(), name: clean.charAt(0).toUpperCase() + clean.slice(1) };
  d.prepare('insert into exercises (id, user_id, name) values (?, ?, ?)').run(e.id, userId, e.name);
  return e;
}

export function readWorkouts(d: Database.Database, userId: string): Workout[] {
  const ws = d
    .prepare(
      `select id, title, day, started_at, finished_at, note, template_id from workouts
       where user_id = ? order by day desc, started_at desc limit ?`,
    )
    .all(userId, HISTORY) as Omit<Workout, 'exercises'>[];
  if (!ws.length) return [];
  const ids = JSON.stringify(ws.map((w) => w.id));
  const wes = d
    .prepare(`select id, workout_id, exercise_id from workout_exercises where workout_id in (select value from json_each(?)) order by position`)
    .all(ids) as { id: string; workout_id: string; exercise_id: string }[];
  const sets = d
    .prepare(
      `select s.id, s.workout_exercise_id, s.weight, s.reps from workout_sets s
       join workout_exercises e on e.id = s.workout_exercise_id
       where e.workout_id in (select value from json_each(?)) order by s.position, s.created_at`,
    )
    .all(ids) as { id: string; workout_exercise_id: string; weight: number | null; reps: number }[];
  return ws.map((w) => ({
    ...w,
    exercises: wes
      .filter((e) => e.workout_id === w.id)
      .map((e) => ({
        id: e.id,
        exercise_id: e.exercise_id,
        sets: sets.filter((s) => s.workout_exercise_id === e.id).map(({ id, weight, reps }) => ({ id, weight, reps })),
      })),
  }));
}

export function readTemplates(d: Database.Database, userId: string): WorkoutTemplate[] {
  return (
    d.prepare('select id, title, weekdays, plan from workout_templates where user_id = ? order by created_at').all(userId) as {
      id: string;
      title: string;
      weekdays: string;
      plan: string;
    }[]
  ).map((t) => ({ id: t.id, title: t.title, weekdays: JSON.parse(t.weekdays), plan: JSON.parse(t.plan) }));
}

export function ownWorkout(d: Database.Database, userId: string, id: unknown): { id: string } | null {
  if (typeof id !== 'string') return null;
  return (d.prepare('select id from workouts where id = ? and user_id = ?').get(id, userId) as { id: string } | undefined) ?? null;
}

export function ownWorkoutExercise(d: Database.Database, userId: string, id: unknown): { id: string; workout_id: string } | null {
  if (typeof id !== 'string') return null;
  return (
    (d
      .prepare('select e.id, e.workout_id from workout_exercises e join workouts w on w.id = e.workout_id where e.id = ? and w.user_id = ?')
      .get(id, userId) as { id: string; workout_id: string } | undefined) ?? null
  );
}

export function ownSet(d: Database.Database, userId: string, id: unknown): { id: string } | null {
  if (typeof id !== 'string') return null;
  return (
    (d
      .prepare(
        `select s.id from workout_sets s join workout_exercises e on e.id = s.workout_exercise_id
         join workouts w on w.id = e.workout_id where s.id = ? and w.user_id = ?`,
      )
      .get(id, userId) as { id: string } | undefined) ?? null
  );
}
