import { addDays, diffDays, weekday } from './recur';

/**
 * Журнал тренировок без базы: рекорды, «прошлый раз», тоннаж, лучший подход
 * по неделям, длительность. Одно и то же на сервере и на экране.
 */

export interface WorkoutSet {
  id: string;
  /** null — свой вес. */
  weight: number | null;
  reps: number;
}

export interface WorkoutExercise {
  id: string;
  exercise_id: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  title: string;
  /** Местная дата 'ГГГГ-ММ-ДД'. */
  day: string;
  /** UTC из базы: 'ГГГГ-ММ-ДД ЧЧ:ММ:СС'. */
  started_at: string;
  finished_at: string | null;
  note: string | null;
  template_id: string | null;
  exercises: WorkoutExercise[];
}

export interface Exercise {
  id: string;
  name: string;
}

export interface TemplatePlanItem {
  exercise_id: string;
  sets: number;
  reps: number;
  weight: number | null;
}

export interface WorkoutTemplate {
  id: string;
  title: string;
  /** 0 — воскресенье … 6 — суббота. */
  weekdays: number[];
  plan: TemplatePlanItem[];
}

/** Тоннаж: сумма вес × повторы (подходы со своим весом не считаются). */
export function tonnage(w: Pick<Workout, 'exercises'>): number {
  let t = 0;
  for (const e of w.exercises) for (const s of e.sets) if (s.weight) t += s.weight * s.reps;
  return Math.round(t);
}

/** Лучший подход: больший вес, при равном — больше повторов; свой вес — по повторам. */
export function better(a: Pick<WorkoutSet, 'weight' | 'reps'>, b: Pick<WorkoutSet, 'weight' | 'reps'>): boolean {
  const wa = a.weight ?? 0;
  const wb = b.weight ?? 0;
  return wa > wb || (wa === wb && a.reps > b.reps);
}

export function bestSet<S extends Pick<WorkoutSet, 'weight' | 'reps'>>(sets: S[]): S | null {
  let best: S | null = null;
  for (const s of sets) if (!best || better(s, best)) best = s;
  return best;
}

/** Хронологический порядок тренировок: по дню, затем по времени начала. */
const chrono = (a: Workout, b: Workout) => a.day.localeCompare(b.day) || a.started_at.localeCompare(b.started_at);

/**
 * id подходов-рекордов: лучше всего, что было по этому упражнению раньше
 * (в прошлых тренировках и предыдущих подходах этой). Первый в истории
 * подход рекордом не считается — сравнивать не с чем.
 */
export function recordSetIds(workouts: Workout[]): Set<string> {
  const best = new Map<string, Pick<WorkoutSet, 'weight' | 'reps'>>();
  const out = new Set<string>();
  for (const w of [...workouts].sort(chrono)) {
    for (const e of w.exercises) {
      for (const s of e.sets) {
        const prev = best.get(e.exercise_id);
        if (prev && better(s, prev)) out.add(s.id);
        if (!prev || better(s, prev)) best.set(e.exercise_id, s);
      }
    }
  }
  return out;
}

/** Последний раз упражнение до этой тренировки (её саму не считаем): лучший подход и все подходы. */
export function lastTime(
  workouts: Workout[],
  exerciseId: string,
  before: Pick<Workout, 'id' | 'day' | 'started_at'>,
): { day: string; best: WorkoutSet; sets: WorkoutSet[] } | null {
  const earlier = workouts
    .filter((w) => w.id !== before.id && chrono(w, before as Workout) < 0)
    .sort(chrono)
    .reverse();
  for (const w of earlier) {
    const sets = w.exercises.filter((e) => e.exercise_id === exerciseId).flatMap((e) => e.sets);
    const best = bestSet(sets);
    if (best) return { day: w.day, best, sets };
  }
  return null;
}

/** Понедельник недели дня. */
function monday(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** Лучший вес по неделям за последние `weeks` недель до `today` (пустые недели — null). */
export function weeklyBest(workouts: Workout[], exerciseId: string, today: string, weeks = 10): { week: string; weight: number | null }[] {
  const start = addDays(monday(today), -7 * (weeks - 1));
  const out = Array.from({ length: weeks }, (_, i) => ({ week: addDays(start, 7 * i), weight: null as number | null }));
  for (const w of workouts) {
    if (w.day < start) continue;
    const i = Math.floor(diffDays(start, w.day) / 7);
    if (i < 0 || i >= weeks) continue;
    for (const e of w.exercises) {
      if (e.exercise_id !== exerciseId) continue;
      for (const s of e.sets) if (s.weight !== null && (out[i].weight === null || s.weight > out[i].weight!)) out[i].weight = s.weight;
    }
  }
  return out;
}

/** Рекорд по упражнению за всё время. */
export function personalBest(workouts: Workout[], exerciseId: string): WorkoutSet | null {
  return bestSet(workouts.flatMap((w) => w.exercises.filter((e) => e.exercise_id === exerciseId).flatMap((e) => e.sets)));
}

/** «52 мин», «1 ч 05 мин»; между двумя UTC-отметками из базы. */
export function duration(startedAt: string, finishedAt: string | null, now = new Date()): string {
  const a = Date.parse(startedAt.replace(' ', 'T') + 'Z');
  const b = finishedAt ? Date.parse(finishedAt.replace(' ', 'T') + 'Z') : now.getTime();
  const m = Math.max(0, Math.round((b - a) / 60000));
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

/** «72,5 кг × 6», «свой вес × 10». */
export function setLabel(s: Pick<WorkoutSet, 'weight' | 'reps'>): string {
  return `${s.weight === null ? 'свой вес' : `${String(s.weight).replace('.', ',')} кг`} × ${s.reps}`;
}

/** Шаблон, запланированный на этот день недели. */
export function plannedFor(templates: WorkoutTemplate[], day: string): WorkoutTemplate | null {
  const wd = weekday(day);
  return templates.find((t) => t.weekdays.includes(wd)) ?? null;
}

/** Привычные упражнения — подсказки при вводе. */
export const COMMON_EXERCISES = [
  'Жим штанги лёжа',
  'Жим гантелей лёжа',
  'Жим штанги стоя',
  'Жим гантелей сидя',
  'Приседания со штангой',
  'Фронтальные приседания',
  'Жим ногами',
  'Выпады с гантелями',
  'Румынская тяга',
  'Становая тяга',
  'Тяга штанги в наклоне',
  'Тяга гантели в наклоне',
  'Тяга верхнего блока',
  'Тяга нижнего блока',
  'Подтягивания',
  'Отжимания',
  'Отжимания на брусьях',
  'Подъём штанги на бицепс',
  'Молотки с гантелями',
  'Французский жим',
  'Разгибания на трицепс в блоке',
  'Разведения гантелей в стороны',
  'Подъём на носки стоя',
  'Сгибания ног в тренажёре',
  'Разгибания ног в тренажёре',
  'Скручивания',
  'Планка',
];
