import { randomUUID } from 'node:crypto';
import { bestSet, type TemplatePlanItem } from '@/lib/workouts';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import { exerciseByName, ownSet, ownWorkout, ownWorkoutExercise, readWorkouts } from '../workoutStore';

function weight(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, 'Вес — от 0 до 1000 кг.');
  return n === 0 ? null : Math.round(n * 100) / 100;
}

function reps(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, 'Повторы — целое число от 1.');
  return n;
}

function addExercise(d: Ctx['d'], userId: string, workoutId: string, name: string): string {
  const ex = exerciseByName(d, userId, name);
  const pos = ((d.prepare('select max(position) as m from workout_exercises where workout_id = ?').get(workoutId) as { m: number | null }).m ?? -1) + 1;
  const id = randomUUID();
  d.prepare('insert into workout_exercises (id, workout_id, exercise_id, position) values (?, ?, ?, ?)').run(id, workoutId, ex.id, pos);
  return id;
}

/**
 * Тренировки: /api/workouts[/:id[/exercises]].
 *  POST            { day, title?, template_id? } — начать (по шаблону — с его упражнениями);
 *  PATCH  :id      { title, note, finished: true|false } — правка, «завершить»;
 *  DELETE :id;
 *  POST   :id/exercises { name } — добавить упражнение (новое — в свой справочник).
 */
export function workouts({ d, userId, method, body, id, action }: Ctx): unknown {
  if (method === 'POST' && !id) {
    if (typeof body.day !== 'string' || !DAY_RE.test(body.day)) throw new HttpError(400, 'Неверная дата.');
    const tpl =
      typeof body.template_id === 'string'
        ? (d.prepare('select id, title, plan from workout_templates where id = ? and user_id = ?').get(body.template_id, userId) as
            | { id: string; title: string; plan: string }
            | undefined)
        : undefined;
    const wid = randomUUID();
    d.transaction(() => {
      d.prepare('insert into workouts (id, user_id, title, day, template_id) values (?, ?, ?, ?, ?)').run(
        wid,
        userId,
        text(body.title, 80, 'Название', true) ?? tpl?.title ?? 'Тренировка',
        body.day,
        tpl?.id ?? null,
      );
      if (tpl) {
        const names = d.prepare('select name from exercises where id = ? and user_id = ?');
        for (const p of JSON.parse(tpl.plan) as TemplatePlanItem[]) {
          const ex = names.get(p.exercise_id, userId) as { name: string } | undefined;
          if (ex) addExercise(d, userId, wid, ex.name);
        }
      }
    })();
    return { id: wid };
  }

  const w = ownWorkout(d, userId, id);
  if (!w) throw new HttpError(404, 'Тренировка не найдена.');

  if (method === 'PATCH' && !action) {
    if (body.title !== undefined) d.prepare('update workouts set title = ? where id = ?').run(text(body.title, 80, 'Название'), w.id);
    if (body.note !== undefined) d.prepare('update workouts set note = ? where id = ?').run(text(body.note, 2000, 'Заметка', true), w.id);
    if (body.finished !== undefined) d.prepare(`update workouts set finished_at = ${body.finished ? "datetime('now')" : 'null'} where id = ?`).run(w.id);
    return { ok: true };
  }
  if (method === 'DELETE' && !action) {
    d.prepare('delete from workouts where id = ?').run(w.id);
    return { ok: true };
  }
  if (method === 'POST' && action === 'exercises') {
    return { id: addExercise(d, userId, w.id, text(body.name, 80, 'Упражнение')!) };
  }
  return undefined;
}

/** Упражнение в тренировке: /api/workout-exercises/:id[/sets]. POST …/sets { weight, reps } — подход; DELETE — убрать упражнение. */
export function workoutExercises({ d, userId, method, body, id, action }: Ctx): unknown {
  const we = ownWorkoutExercise(d, userId, id);
  if (!we) throw new HttpError(404, 'Упражнение не найдено.');
  if (method === 'POST' && action === 'sets') {
    const sid = randomUUID();
    const pos = ((d.prepare('select max(position) as m from workout_sets where workout_exercise_id = ?').get(we.id) as { m: number | null }).m ?? -1) + 1;
    d.prepare('insert into workout_sets (id, workout_exercise_id, weight, reps, position) values (?, ?, ?, ?, ?)').run(sid, we.id, weight(body.weight), reps(body.reps), pos);
    return { id: sid };
  }
  if (method === 'DELETE' && !action) {
    d.prepare('delete from workout_exercises where id = ?').run(we.id);
    return { ok: true };
  }
  return undefined;
}

/** Подход: /api/workout-sets/:id. PATCH { weight, reps }, DELETE. */
export function workoutSets({ d, userId, method, body, id }: Ctx): unknown {
  const s = ownSet(d, userId, id);
  if (!s) throw new HttpError(404, 'Подход не найден.');
  if (method === 'PATCH') {
    if (body.weight !== undefined) d.prepare('update workout_sets set weight = ? where id = ?').run(weight(body.weight), s.id);
    if (body.reps !== undefined) d.prepare('update workout_sets set reps = ? where id = ?').run(reps(body.reps), s.id);
    return { ok: true };
  }
  if (method === 'DELETE') {
    d.prepare('delete from workout_sets where id = ?').run(s.id);
    return { ok: true };
  }
  return undefined;
}

/**
 * Шаблоны: /api/workout-templates[/:id].
 *  POST { from_workout, title?, weekdays } — из тренировки: её упражнения и
 *        лучший подход каждого как план (подходов столько же);
 *  PATCH :id { title, weekdays }; DELETE :id.
 */
export function workoutTemplates({ d, userId, method, body, id }: Ctx): unknown {
  const days = (v: unknown): number[] => {
    if (!Array.isArray(v)) throw new HttpError(400, 'Дни недели — списком.');
    return [...new Set(v.map(Number))].filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).sort();
  };

  if (method === 'POST' && !id) {
    const w = ownWorkout(d, userId, body.from_workout);
    if (!w) throw new HttpError(404, 'Тренировка не найдена.');
    const full = readWorkouts(d, userId).find((x) => x.id === w.id);
    if (!full || !full.exercises.length) throw new HttpError(400, 'В тренировке нет упражнений.');
    const plan: TemplatePlanItem[] = full.exercises.map((e) => {
      const b = bestSet(e.sets);
      return { exercise_id: e.exercise_id, sets: Math.max(1, e.sets.length), reps: b?.reps ?? 8, weight: b?.weight ?? null };
    });
    const tid = randomUUID();
    d.prepare('insert into workout_templates (id, user_id, title, weekdays, plan) values (?, ?, ?, ?, ?)').run(
      tid,
      userId,
      text(body.title, 80, 'Название', true) ?? (d.prepare('select title from workouts where id = ?').get(w.id) as { title: string }).title,
      JSON.stringify(days(body.weekdays ?? [])),
      JSON.stringify(plan),
    );
    return { id: tid };
  }

  const t = typeof id === 'string' ? (d.prepare('select id from workout_templates where id = ? and user_id = ?').get(id, userId) as { id: string } | undefined) : undefined;
  if (!t) throw new HttpError(404, 'Шаблон не найден.');
  if (method === 'PATCH') {
    if (body.title !== undefined) d.prepare('update workout_templates set title = ? where id = ?').run(text(body.title, 80, 'Название'), t.id);
    if (body.weekdays !== undefined) d.prepare('update workout_templates set weekdays = ? where id = ?').run(JSON.stringify(days(body.weekdays)), t.id);
    return { ok: true };
  }
  if (method === 'DELETE') {
    d.prepare('delete from workout_templates where id = ?').run(t.id);
    return { ok: true };
  }
  return undefined;
}
