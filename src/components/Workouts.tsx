'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { localDay, plural } from '@/lib/dates';
import { WEEKDAY_SHORT } from '@/lib/recur';
import {
  COMMON_EXERCISES,
  duration,
  lastTime,
  personalBest,
  plannedFor,
  recordSetIds,
  setLabel,
  tonnage,
  weeklyBest,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/lib/workouts';
import { AiButton, useAiReady } from './Ai';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const fmtW = (n: number) => String(n).replace('.', ',');

/** «ср 1 окт» по местной дате. */
function dayShort(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}`;
}

// ---------------------------------------------------------------- данные

/** Тренировки и правки: на экране — сразу, на сервере — следом. */
export function useGym() {
  const { data, mutate, reload, toast, now } = useApp();
  const gym = data.gym;
  const names = useMemo(() => new Map(gym.exercises.map((e) => [e.id, e.name])), [gym.exercises]);
  const records = useMemo(() => recordSetIds(gym.workouts), [gym.workouts]);
  const today = localDay(now);
  const active = gym.workouts.find((w) => !w.finished_at && w.day === today) ?? null;

  const editWorkout = (id: string, fn: (w: Workout) => Workout) => (d: typeof data) => ({
    ...d,
    gym: { ...d.gym, workouts: d.gym.workouts.map((w) => (w.id === id ? fn(w) : w)) },
  });

  const start = async (templateId?: string, title?: string): Promise<string | null> => {
    try {
      const r = await api<{ id: string }>('workouts', 'POST', { day: today, template_id: templateId, title });
      await reload();
      return r.id;
    } catch (e) {
      toast((e as Error).message);
      return null;
    }
  };

  return { gym, names, records, today, active, editWorkout, start, mutate, reload, toast, now };
}

// ---------------------------------------------------------------- упражнение в тренировке

function ExerciseCard({ w, e, onLogged }: { w: Workout; e: WorkoutExercise; onLogged: () => void }) {
  const { gym, names, records, editWorkout, mutate, toast } = useGym();
  const last = lastTime(gym.workouts, e.exercise_id, w);
  const plan = w.template_id ? gym.templates.find((t) => t.id === w.template_id)?.plan.find((p) => p.exercise_id === e.exercise_id) : undefined;
  const prev = e.sets[e.sets.length - 1] ?? last?.best ?? null;
  // Поля — как в прошлом подходе (или прошлой тренировке), иначе по плану шаблона.
  const [weight, setWeight] = useState(prev ? (prev.weight === null ? '' : fmtW(prev.weight)) : plan?.weight ? fmtW(plan.weight) : '');
  const [reps, setReps] = useState(String(prev?.reps ?? plan?.reps ?? 8));
  const [confirm, setConfirm] = useState(false);
  const name = names.get(e.exercise_id) ?? 'Упражнение';

  const log = async (wv: string, rv: string) => {
    const body = { weight: wv.trim() ? Number(wv.replace(',', '.')) : null, reps: Number(rv) };
    try {
      const r = await api<{ id: string }>(`workout-exercises/${e.id}/sets`, 'POST', body);
      const s: WorkoutSet = { id: r.id, weight: body.weight || null, reps: body.reps };
      mutate(
        editWorkout(w.id, (x) => ({ ...x, exercises: x.exercises.map((y) => (y.id === e.id ? { ...y, sets: [...y.sets, s] } : y)) })),
        async () => {},
      );
      onLogged();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const removeSet = (s: WorkoutSet) =>
    mutate(
      editWorkout(w.id, (x) => ({ ...x, exercises: x.exercises.map((y) => (y.id === e.id ? { ...y, sets: y.sets.filter((z) => z.id !== s.id) } : y)) })),
      () => api(`workout-sets/${s.id}`, 'DELETE'),
    );

  const removeExercise = () =>
    mutate(
      editWorkout(w.id, (x) => ({ ...x, exercises: x.exercises.filter((y) => y.id !== e.id) })),
      () => api(`workout-exercises/${e.id}`, 'DELETE'),
    );

  const lastSet = e.sets[e.sets.length - 1];
  return (
    <section className="ex-card" aria-label={name}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, flex: 1, minWidth: 0 }}>{name}</h3>
        <button className="icon-btn bare" type="button" style={{ width: 32, height: 32 }} aria-label={`Убрать «${name}»`} onClick={() => (e.sets.length ? setConfirm(true) : removeExercise())}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {(plan || last) && (
        <span style={{ fontSize: 13, color: 'var(--muted)', marginTop: -6 }}>
          {plan && `план ${plan.sets} × ${plan.reps}${plan.weight ? ` по ${fmtW(plan.weight)} кг` : ''}`}
          {plan && last && ' · '}
          {last && `прошлый раз ${setLabel(last.best)}`}
        </span>
      )}
      {e.sets.length > 0 && (
        <div className="set head" aria-hidden="true">
          <span>Подх.</span>
          <span>Вес</span>
          <span>Повт.</span>
          <span />
        </div>
      )}
      {e.sets.map((s, i) => {
        const rec = records.has(s.id);
        return (
          <div key={s.id} className={`set${rec ? ' rec' : ''}`}>
            <span className="mono" style={{ color: 'var(--muted)' }}>
              {i + 1}
            </span>
            <span className="mono" style={{ fontWeight: 500 }}>
              {s.weight === null ? 'свой вес' : `${fmtW(s.weight)} кг`}
            </span>
            <span className="mono">× {s.reps}</span>
            <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
              {rec && (
                <span className="chip chip-warm" title="Лучше, чем было раньше">
                  <Icon name="trophy" size={14} />
                  рекорд
                </span>
              )}
              <button className="icon-btn bare" type="button" style={{ width: 32, height: 32 }} aria-label={`Удалить подход ${i + 1}`} onClick={() => removeSet(s)}>
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        );
      })}
      {!w.finished_at && (
        <form
          className="set new"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (Number(reps) >= 1) log(weight, reps);
          }}
        >
          <span className="mono" style={{ color: 'var(--muted)' }}>
            {e.sets.length + 1}
          </span>
          <label className="sr-only" htmlFor={`w-${e.id}`}>
            Вес, кг
          </label>
          <input id={`w-${e.id}`} className="field mono" inputMode="decimal" placeholder="свой" value={weight} onChange={(ev) => setWeight(ev.target.value)} />
          <label className="sr-only" htmlFor={`r-${e.id}`}>
            Повторы
          </label>
          <input id={`r-${e.id}`} className="field mono" inputMode="numeric" value={reps} onChange={(ev) => setReps(ev.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-primary" type="submit" aria-label={`Записать подход: ${name}`} style={{ padding: '6px 10px' }}>
            <Icon name="check" size={18} />
          </button>
        </form>
      )}
      {!w.finished_at && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="chip" type="button" onClick={() => setWeight(fmtW(Math.round(((Number(weight.replace(',', '.')) || 0) + 2.5) * 100) / 100))}>
            +2,5 кг
          </button>
          {lastSet && (
            <button className="chip" type="button" onClick={() => log(lastSet.weight === null ? '' : String(lastSet.weight), String(lastSet.reps))}>
              Повторить {setLabel(lastSet)}
            </button>
          )}
        </div>
      )}
      {confirm && (
        <Confirm
          title={`Убрать «${name}»?`}
          text={`Из тренировки удалятся и ${plural(e.sets.length, 'подход', 'подхода', 'подходов')}.`}
          action="Убрать"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            removeExercise();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- тренировка

function WorkoutView({ w, onBack, onDeleted }: { w: Workout; onBack: () => void; onDeleted: () => void }) {
  const { gym, editWorkout, mutate, reload, toast, now } = useGym();
  const [exName, setExName] = useState('');
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState<number[] | null>(null);

  // Таймер отдыха: секунды с последнего записанного подхода.
  useEffect(() => {
    if (lastAt === null) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [lastAt]);
  const rest = lastAt === null ? null : Math.floor((Date.now() - lastAt) / 1000);
  void tick;

  const addExercise = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!exName.trim()) return;
    try {
      await api(`workouts/${w.id}/exercises`, 'POST', { name: exName.trim() });
      setExName('');
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const finish = (finished: boolean) =>
    mutate(
      editWorkout(w.id, (x) => ({ ...x, finished_at: finished ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null })),
      () => api(`workouts/${w.id}`, 'PATCH', { finished }),
    );

  const saveTemplate = async (weekdays: number[]) => {
    try {
      await api('workout-templates', 'POST', { from_workout: w.id, weekdays });
      setSaving(null);
      await reload();
      toast('Шаблон сохранён');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const suggestions = [...new Set([...gym.exercises.map((e) => e.name), ...COMMON_EXERCISES])];
  const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);

  return (
    <article className="card" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <button className="icon-btn bare only-mobile" type="button" aria-label="Назад к журналу" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 26 }}>
            {w.title}
          </h2>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            {dayShort(w.day)} · {w.finished_at ? duration(w.started_at, w.finished_at) : `идёт ${duration(w.started_at, null, now)}`}
            {tonnage(w) > 0 && ` · тоннаж ${tonnage(w).toLocaleString('ru-RU')} кг`}
            {sets > 0 && ` · ${plural(sets, 'подход', 'подхода', 'подходов')}`}
          </div>
        </div>
        {w.finished_at ? (
          <button className="btn btn-ghost" type="button" onClick={() => finish(false)}>
            Продолжить
          </button>
        ) : (
          <button className="btn btn-primary" type="button" onClick={() => finish(true)}>
            <Icon name="check" size={18} />
            Завершить
          </button>
        )}
        <details className="menu">
          <summary className="icon-btn" aria-label="Ещё действия с тренировкой">
            <Icon name="dots" />
          </summary>
          <div className="menu-list">
            <button
              type="button"
              disabled={!w.exercises.length}
              onClick={(e) => {
                (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                setSaving([]);
              }}
            >
              Сохранить как шаблон
            </button>
            <button
              type="button"
              onClick={(e) => {
                (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                setConfirm(true);
              }}
            >
              Удалить тренировку
            </button>
          </div>
        </details>
      </div>

      {saving && (
        <div className="added-box" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <span>Шаблон «{w.title}». В какие дни предлагать на главной?</span>
          <div role="group" aria-label="Дни недели" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEEK.map((d) => (
              <button
                key={d}
                type="button"
                className="chip"
                aria-pressed={saving.includes(d)}
                onClick={() => setSaving(saving.includes(d) ? saving.filter((x) => x !== d) : [...saving, d])}
              >
                {WEEKDAY_SHORT[d]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="button" onClick={() => saveTemplate(saving)}>
              Сохранить шаблон
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setSaving(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {rest !== null && !w.finished_at && (
        <div className="rest" role="timer" aria-live="off">
          <Icon name="timer" size={18} />
          Отдых {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}
        </div>
      )}

      {w.exercises.length === 0 && <p style={{ margin: 0, color: 'var(--muted)' }}>Добавьте первое упражнение.</p>}
      {w.exercises.map((e) => (
        <ExerciseCard key={e.id} w={w} e={e} onLogged={() => setLastAt(Date.now())} />
      ))}

      <form onSubmit={addExercise} style={{ display: 'flex', gap: 8 }}>
        <label className="sr-only" htmlFor="ex-add">
          Упражнение
        </label>
        <input id="ex-add" className="field" list="exercise-names" placeholder="Добавить упражнение" value={exName} onChange={(e) => setExName(e.target.value)} />
        <datalist id="exercise-names">
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <button className="btn btn-ghost" type="submit" disabled={!exName.trim()}>
          <Icon name="plus" size={18} />
          Упражнение
        </button>
      </form>

      {confirm && (
        <Confirm
          title={`Удалить тренировку «${w.title}»?`}
          text="Удалятся все её подходы."
          action="Удалить"
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            try {
              await api(`workouts/${w.id}`, 'DELETE');
              await reload();
              onDeleted();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------- прогресс

/** Совет по упражнению от ИИ — по журналу подходов. */
function Advice({ exerciseId }: { exerciseId: string }) {
  const { toast } = useApp();
  const ready = useAiReady();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  return (
    <>
      {text && <p className="added-box" style={{ fontWeight: 400, lineHeight: 1.55, margin: 0 }}>{text}</p>}
      <AiButton
        busy={busy}
        style={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          setBusy(true);
          try {
            setText((await api<{ text: string }>('ai/workout-advice', 'POST', { exercise_id: exerciseId })).text);
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {text ? 'Ещё совет' : 'Совет тренера'}
      </AiButton>
    </>
  );
}

function Progress() {
  const { gym, names, today } = useGym();
  const used = [...new Set(gym.workouts.flatMap((w) => w.exercises.filter((e) => e.sets.some((s) => s.weight !== null)).map((e) => e.exercise_id)))];
  const [ex, setEx] = useState<string>(used[0] ?? '');
  const id = used.includes(ex) ? ex : used[0];
  if (!id) {
    return (
      <section className="card" aria-labelledby="pr-title">
        <h2 className="card-title display" id="pr-title">
          <Icon name="chart" />
          Прогресс
        </h2>
        <p style={{ margin: 0, color: 'var(--muted)' }}>Появится после первых подходов с весом.</p>
      </section>
    );
  }
  const weeks = weeklyBest(gym.workouts, id, today, 10);
  const vals = weeks.map((w) => w.weight).filter((x): x is number => x !== null);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pb = personalBest(gym.workouts, id);
  const firstVal = vals[0];
  const lastVal = vals[vals.length - 1];
  const delta = vals.length > 1 ? Math.round((lastVal - firstVal) * 100) / 100 : null;

  return (
    <section className="card" aria-labelledby="pr-title">
      <h2 className="card-title display" id="pr-title">
        <Icon name="chart" />
        Прогресс
      </h2>
      <label className="sr-only" htmlFor="pr-ex">
        Упражнение
      </label>
      <select id="pr-ex" className="field" value={id} onChange={(e) => setEx(e.target.value)}>
        {used.map((u) => (
          <option key={u} value={u}>
            {names.get(u)}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Рекорд</div>
          <div className="display" style={{ fontSize: 24, fontWeight: 700 }}>
            {pb ? setLabel(pb) : '—'}
          </div>
        </div>
        {delta !== null && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>За 10 недель</div>
            <div className="display" style={{ fontSize: 24, fontWeight: 700, color: delta > 0 ? 'var(--accent-ink)' : undefined }}>
              {delta > 0 ? '+' : ''}
              {fmtW(delta)} кг
            </div>
          </div>
        )}
      </div>
      <div className="bars" role="img" aria-label={`Лучший вес по неделям: ${weeks.map((w) => (w.weight === null ? 'нет' : `${fmtW(w.weight)} кг`)).join(', ')}`}>
        {weeks.map((w, i) => {
          const h = w.weight === null ? 0 : max === min ? 70 : 20 + ((w.weight - min) / (max - min)) * 80;
          return (
            <div key={w.week} className="bar-col">
              <span className="mono">{w.weight === null ? '' : fmtW(w.weight)}</span>
              <i style={{ height: `${h}%`, background: i === weeks.length - 1 ? 'var(--accent)' : 'var(--bar-soft)' }} />
              {/* Подпись — у каждой третьей недели и у последней, иначе не влезают. */}
              <span className="mono">{i % 3 === 0 || i === weeks.length - 1 ? `${Number(w.week.slice(8))}.${w.week.slice(5, 7)}` : ''}</span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Лучший вес за неделю. Подписи — понедельник недели.</p>
      <Advice key={id} exerciseId={id} />
    </section>
  );
}

// ---------------------------------------------------------------- шаблоны

function Templates({ onStarted }: { onStarted: (id: string) => void }) {
  const { gym, names, mutate, start, today } = useGym();
  const planned = plannedFor(gym.templates, today);
  if (!gym.templates.length) return null;
  return (
    <section className="card" aria-labelledby="tpl-title" style={{ gap: 10 }}>
      <h2 className="card-title display" id="tpl-title">
        Шаблоны
      </h2>
      {gym.templates.map((t) => (
        <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, flex: 1 }}>
              {t.title}
              {planned?.id === t.id && <span className="badge" style={{ marginLeft: 6 }}>сегодня</span>}
            </span>
            <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px' }} onClick={async () => {
              const id = await start(t.id);
              if (id) onStarted(id);
            }}>
              Начать
            </button>
            <button
              className="icon-btn bare"
              type="button"
              aria-label={`Удалить шаблон «${t.title}»`}
              onClick={() => mutate((d) => ({ ...d, gym: { ...d.gym, templates: d.gym.templates.filter((x) => x.id !== t.id) } }), () => api(`workout-templates/${t.id}`, 'DELETE'))}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t.plan.map((p) => names.get(p.exercise_id)).filter(Boolean).join(', ')}</span>
          <div role="group" aria-label={`Дни шаблона «${t.title}»`} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {WEEK.map((d) => {
              const on = t.weekdays.includes(d);
              const next = on ? t.weekdays.filter((x) => x !== d) : [...t.weekdays, d].sort();
              return (
                <button
                  key={d}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  style={{ minWidth: 38, justifyContent: 'center' }}
                  onClick={() =>
                    mutate(
                      (x) => ({ ...x, gym: { ...x.gym, templates: x.gym.templates.map((y) => (y.id === t.id ? { ...y, weekdays: next } : y)) } }),
                      () => api(`workout-templates/${t.id}`, 'PATCH', { weekdays: next }),
                    )
                  }
                >
                  {WEEKDAY_SHORT[d]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- экран

/** Тренировки: журнал слева, открытая тренировка, справа — прогресс и шаблоны. */
export default function Workouts() {
  const { gym, start, active, today } = useGym();
  const params = useSearchParams();
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get('open');
    if (id) setSel(id);
  }, [params]);

  const select = (id: string | null) => {
    setSel(id);
    router.replace(id ? `/workouts?open=${id}` : '/workouts', { scroll: false });
  };
  const open = gym.workouts.find((w) => w.id === sel) ?? null;
  const planned = plannedFor(gym.templates, today);

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Тренировки
        </h1>
        {active ? (
          <button className="btn btn-primary" type="button" onClick={() => select(active.id)}>
            Идёт: {active.title}
          </button>
        ) : (
          <>
            {planned && (
              <button className="btn btn-primary" type="button" onClick={async () => {
                const id = await start(planned.id);
                if (id) select(id);
              }}>
                <Icon name="dumbbell" size={18} />
                {planned.title} — по плану
              </button>
            )}
            <button className={`btn ${planned ? 'btn-ghost' : 'btn-primary'}`} type="button" onClick={async () => {
              const id = await start();
              if (id) select(id);
            }}>
              <Icon name="plus" size={18} />
              Новая тренировка
            </button>
          </>
        )}
      </div>
      <div className="gym-layout" data-detail={open ? 'true' : 'false'}>
        <aside className="gym-log">
          <h2 className="group-title" style={{ padding: '0 4px 4px' }}>
            Журнал
          </h2>
          {gym.workouts.length === 0 && <p style={{ margin: 0, color: 'var(--muted)' }}>Тренировок пока нет — начните первую.</p>}
          {gym.workouts.slice(0, 40).map((w) => (
            <button key={w.id} type="button" className="note-card" aria-current={w.id === sel ? 'true' : undefined} onClick={() => select(w.id)}>
              <span style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontWeight: 600, flex: 1 }}>{w.title}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {dayShort(w.day)}
                </span>
              </span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {w.finished_at ? duration(w.started_at, w.finished_at) : 'идёт'} · {plural(w.exercises.length, 'упражнение', 'упражнения', 'упражнений')}
              </span>
            </button>
          ))}
        </aside>
        <div className="gym-main">
          {open ? (
            <WorkoutView key={open.id} w={open} onBack={() => select(null)} onDeleted={() => select(null)} />
          ) : (
            <div className="panel" style={{ padding: 24, color: 'var(--muted)' }}>
              Выберите тренировку в журнале или начните новую.
            </div>
          )}
        </div>
        <div className="gym-side">
          <Progress />
          <Templates onStarted={select} />
        </div>
      </div>
    </>
  );
}
