'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { localDay, minutesOf } from '@/lib/dates';
import { addDays, describe, dueDay, type Rule } from '@/lib/recur';
import { dueLabel, firstDue, knownTags, nextDue, shortDate, type Task } from '@/lib/tasks';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';
import { Fab, Sheet, useIsPhone } from './Phone';
import Empty from './Empty';
import Reminders from './Reminders';
import { useReminderActions } from './reminderActions';
import { timeline, type Row } from '@/lib/timeline';
import Swipe from './Swipe';

// ---------------------------------------------------------------- действия

/** Отметить / снять отметку. Повторяющееся дело переезжает на следующий срок. */
export function useTaskActions() {
  const { mutate, reload, now, toast } = useApp();
  const today = localDay(now);

  const complete = (t: Task) => {
    const next = t.rule ? nextDue(t.rule, t.due_date, today) : null;
    // Короткий отклик пальцу (Android; iPhone вибрацию сайтам не даёт).
    navigator.vibrate?.(12);
    mutate(
      (d) => ({
        ...d,
        tasks: d.tasks.map((x) => (x.id === t.id ? (next ? { ...x, due_date: next } : { ...x, done_at: today }) : x)),
        tasksDoneToday: [...d.tasksDoneToday.filter((x) => x !== t.id), t.id],
      }),
      () => api(`tasks/${t.id}/done`, 'POST', { day: today }),
    );
    toast(next ? `Сделано. Следующий раз — ${dueLabel(next, today)?.text}` : `Сделано: «${t.title}»`, () => undo(t));
  };

  function undo(t: Task) {
    mutate(
      (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done_at: null } : x)), tasksDoneToday: d.tasksDoneToday.filter((x) => x !== t.id) }),
      async () => {
        await api(`tasks/${t.id}/undo`, 'POST', { day: today });
        // Прежний срок повторяющегося дела знает сервер.
        await reload();
      },
    );
  }

  /** На завтра (свайп влево): срок — завтра, дело уйдёт из сегодняшних. */
  const tomorrow = (t: Task) => {
    const day = addDays(today, 1);
    mutate(
      (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, due_date: day } : x)) }),
      () => api(`tasks/${t.id}`, 'PATCH', { due_date: day }),
    );
    const was = t.due_date;
    toast(`«${t.title}» — на завтра`, () =>
      mutate(
        (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, due_date: was } : x)) }),
        () => api(`tasks/${t.id}`, 'PATCH', { due_date: was }),
      ),
    );
  };

  const remove = (t: Task) => {
    mutate(
      (d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }),
      () => api(`tasks/${t.id}`, 'DELETE'),
    );
    // Вернуть — заводим заново с теми же полями (история отметок не вернётся).
    toast(`Удалено: «${t.title}»`, async () => {
      try {
        await api('tasks', 'POST', { title: t.title, due_date: t.due_date, rule: t.rule, tag: t.tag, note: t.note, shared: !!t.household_id });
        await reload();
      } catch (e) {
        toast((e as Error).message);
      }
    });
  };

  return { complete, undo, tomorrow, remove, today };
}

// ---------------------------------------------------------------- строка дела

const TONE: Record<string, string> = { danger: 'chip-danger', warm: 'chip-warm', muted: '' };

export function TaskRow({ task, onOpen, showDate = false, hideDue = false }: { task: Task; onOpen?: (t: Task) => void; showDate?: boolean; hideDue?: boolean }) {
  const { complete, undo, tomorrow, remove, today } = useTaskActions();
  const done = !!task.done_at;
  const due = dueLabel(task.due_date, today);
  // Чужое общее дело удалить нельзя (сервер не даст) — и свайп не предлагает.
  const canDelete = !task.household_id || !task.author;
  const body = (
    <>
      <span>{task.title}</span>
      {task.tag && <span className="tag">{task.tag}</span>}
      {task.rule && (
        <span className="tag" title={describe(task.rule)}>
          <Icon name="repeat" size={12} /> {describe(task.rule)}
        </span>
      )}
      {task.household_id && (
        <span className="tag" title={task.author ? `Общее, завёл(а) ${task.author}` : 'Общее дело семьи'}>
          <Icon name="users" size={12} /> {task.author ?? 'общее'}
        </span>
      )}
      {!showDate && !hideDue && due && !done && <span className={`chip ${TONE[due.tone]}`}>{due.text}</span>}
    </>
  );
  return (
    <Swipe
      onRight={done ? undefined : () => complete(task)}
      actions={
        done
          ? []
          : [
              ...(task.due_date !== addDays(today, 1) ? [{ label: 'Завтра', icon: 'calendar', tone: 'warm' as const, onClick: () => tomorrow(task) }] : []),
              ...(canDelete ? [{ label: 'Удалить', icon: 'trash', tone: 'danger' as const, onClick: () => remove(task) }] : []),
            ]
      }
    >
    <div className="task-row">
      <label className={`check round${done ? ' done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
        <input type="checkbox" checked={done} onChange={(e) => (e.target.checked ? complete(task) : undo(task))} aria-label={task.title} />
        {/* Кружок — отметить; текст — открыть дело (кнопка внутри label галочку не ставит). */}
        {onOpen ? (
          <button
            type="button"
            className="check-text task-open"
            onClick={(e) => {
              e.preventDefault();
              onOpen(task);
            }}
          >
            {body}
          </button>
        ) : (
          <span className="check-text task-open">{body}</span>
        )}
      </label>
      {showDate && task.due_date && <span className="mono row-time" style={{ paddingRight: 8 }}>{shortDate(task.due_date, today)}</span>}
    </div>
    </Swipe>
  );
}

// ---------------------------------------------------------------- повтор дела

type RepeatId = 'none' | 'day' | 'week' | 'week2' | 'month' | 'year' | 'after';
const REPEATS: { id: RepeatId; label: string }[] = [
  { id: 'none', label: 'Не повторять' },
  { id: 'day', label: 'Каждый день' },
  { id: 'week', label: 'Каждую неделю' },
  { id: 'week2', label: 'Каждые 2 недели' },
  { id: 'month', label: 'Каждый месяц' },
  { id: 'year', label: 'Каждый год' },
  { id: 'after', label: 'Через N дней после выполнения' },
];

function repeatOf(rule: Rule | null): { id: RepeatId; n: number } {
  if (!rule || rule.kind === 'once') return { id: 'none', n: 7 };
  if (rule.kind === 'after') return { id: 'after', n: rule.every };
  if (rule.unit === 'day') return { id: 'day', n: 7 };
  if (rule.unit === 'week') return { id: rule.every === 2 ? 'week2' : 'week', n: 7 };
  return { id: rule.unit === 'month' ? 'month' : 'year', n: 7 };
}

/** Правило из выбора; первый срок — дата дела. Сложные повторы — в напоминаниях. */
function ruleOf(id: RepeatId, n: number, start: string): Rule | null {
  switch (id) {
    case 'none':
      return null;
    case 'day':
      return { kind: 'repeat', unit: 'day', every: 1, start };
    case 'week':
    case 'week2':
      return { kind: 'repeat', unit: 'week', every: id === 'week2' ? 2 : 1, start };
    case 'month':
      return { kind: 'repeat', unit: 'month', every: 1, start };
    case 'year':
      return { kind: 'repeat', unit: 'year', every: 1, start };
    case 'after':
      return { kind: 'after', unit: 'day', every: Math.max(1, Math.min(365, n)), start };
  }
}

// ---------------------------------------------------------------- форма

interface Draft {
  title: string;
  dated: boolean;
  due: string;
  repeat: RepeatId;
  n: number;
  tag: string;
  shared: boolean;
  note: string;
  /** Напомнить в это время (push) — тогда сохраняется напоминание, а не дело. */
  remind: boolean;
  time: string;
}

function draftOf(t: Task | null, today: string): Draft {
  const r = repeatOf(t?.rule ?? null);
  return {
    title: t?.title ?? '',
    dated: !!t?.due_date,
    due: t?.due_date ?? today,
    repeat: r.id,
    n: r.n,
    tag: t?.tag ?? '',
    shared: !!t?.household_id,
    note: t?.note ?? '',
    remind: false,
    // Ближайший целый час — чтобы напоминание не оказалось в прошлом.
    time: `${String(Math.min(23, new Date().getHours() + 1)).padStart(2, '0')}:00`,
  };
}

function bodyOf(d: Draft, today: string) {
  const rule = d.dated ? ruleOf(d.repeat, d.n, d.due) : null;
  // У повторяющегося первый срок — ближайший подходящий день не раньше даты.
  const due = d.dated ? (rule ? firstDue(rule, d.due < today ? today : d.due) ?? d.due : d.due) : null;
  return { title: d.title.trim(), due_date: due, rule, tag: d.tag.trim() || null, shared: d.shared, note: d.note.trim() || null };
}

/** «Сегодня», «Завтра», «На выходных» (ближайшая суббота), «Через неделю». */
function quickDates(today: string): { label: string; day: string }[] {
  const wd = new Date(`${today}T12:00:00`).getDay();
  const toSat = (6 - wd + 7) % 7 || 7;
  return [
    { label: 'Сегодня', day: today },
    { label: 'Завтра', day: addDays(today, 1) },
    { label: 'На выходных', day: wd === 6 || wd === 0 ? today : addDays(today, toSat) },
    { label: 'Через неделю', day: addDays(today, 7) },
  ];
}

function Fields({ d, set, tags, canShare, today, compact, allowRemind }: { d: Draft; set: (d: Draft) => void; tags: string[]; canShare: boolean; today: string; compact?: boolean; allowRemind?: boolean }) {
  return (
    <div className="task-fields" data-compact={compact ? 'true' : undefined}>
      {d.dated && (
        <>
          <div className="fld">
            <label className="label" htmlFor="t-due">
              Срок
            </label>
            <input id="t-due" className="field" type="date" min={today} value={d.due} onChange={(e) => e.target.value && set({ ...d, due: e.target.value })} />
            <div className="quick-dates" role="group" aria-label="Быстро выбрать срок">
              {quickDates(today).map((q) => (
                <button key={q.label} type="button" className="chip" aria-pressed={d.due === q.day} onClick={() => set({ ...d, due: q.day })}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          {allowRemind && (
            <div className="fld">
              <label className="check" style={{ padding: 0, minHeight: 24 }}>
                <input type="checkbox" checked={d.remind} onChange={(e) => set({ ...d, remind: e.target.checked, repeat: d.repeat === 'after' ? 'none' : d.repeat })} />
                <span className="check-text label">Напомнить в</span>
              </label>
              <input className="field mono" type="time" aria-label="Время напоминания" disabled={!d.remind} value={d.time} onChange={(e) => e.target.value && set({ ...d, time: e.target.value })} />
            </div>
          )}
          <div className="fld">
            <label className="label" htmlFor="t-rep">
              Повтор
            </label>
            <select id="t-rep" className="field" value={d.repeat} onChange={(e) => set({ ...d, repeat: e.target.value as RepeatId })}>
              {REPEATS.filter((r) => !(d.remind && r.id === 'after')).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {d.repeat === 'after' && (
            <div className="fld" style={{ maxWidth: 120 }}>
              <label className="label" htmlFor="t-n">
                Через, дней
              </label>
              <input id="t-n" className="field mono" type="number" min={1} max={365} value={d.n} onChange={(e) => set({ ...d, n: Number(e.target.value) || 1 })} />
            </div>
          )}
        </>
      )}
      <div className="fld">
        <label className="label" htmlFor="t-tag">
          Метка
        </label>
        <input id="t-tag" className="field" list="t-tags" maxLength={30} placeholder="дом, работа…" value={d.tag} onChange={(e) => set({ ...d, tag: e.target.value })} />
        <datalist id="t-tags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {canShare && !d.remind && (
        <label className="check" style={{ alignSelf: 'flex-end' }}>
          <input type="checkbox" checked={d.shared} onChange={(e) => set({ ...d, shared: e.target.checked })} />
          <span className="check-text">Общее для семьи</span>
        </label>
      )}
    </div>
  );
}

function WhenSeg({ dated, set }: { dated: boolean; set: (v: boolean) => void }) {
  return (
    <div className="tabs-row" role="group" aria-label="Когда">
      <button type="button" aria-pressed={!dated} onClick={() => set(false)}>
        Без срока
      </button>
      <button type="button" aria-pressed={dated} onClick={() => set(true)}>
        <Icon name="calendar" size={16} />К дате
      </button>
    </div>
  );
}

/** Быстрое добавление — на экране дел и на главной. */
export function AddTask({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const { data, reload, now, toast } = useApp();
  const today = localDay(now);
  const [d, setD] = useState<Draft>(() => draftOf(null, today));
  const [busy, setBusy] = useState(false);
  const tags = knownTags(data.tasks, data.reminders);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true);
    try {
      if (d.dated && d.remind) {
        // Со временем — это напоминание: придёт push.
        const rule = ruleOf(d.repeat, d.n, d.due < today ? today : d.due) ?? { kind: 'once', date: d.due < today ? today : d.due };
        await api('reminders', 'POST', { title: d.title.trim(), times: [d.time], rule, checklist_id: null, tag: d.tag.trim() || null });
      } else await api('tasks', 'POST', bodyOf(d, today));
      await reload();
      setD({ ...draftOf(null, today), dated: d.dated, due: d.due });
      toast(d.dated && d.remind ? `Напомню в ${d.time}` : 'Дело добавлено');
      onDone?.();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} style={{ padding: 12, gap: 10 }}>
      <div className="add-row">
        <label className="sr-only" htmlFor="new-task">
          Новое дело
        </label>
        <input
          id="new-task"
          className="field"
          style={{ flex: 1 }}
          maxLength={200}
          autoFocus={autoFocus}
          placeholder="Новое дело, например «Отнести куртку в химчистку»"
          value={d.title}
          onChange={(e) => setD({ ...d, title: e.target.value })}
        />
        <WhenSeg dated={d.dated} set={(v) => setD({ ...d, dated: v })} />
        <button className="btn btn-primary" type="submit" disabled={busy || !d.title.trim()} aria-label="Добавить дело">
          <Icon name="plus" size={18} />
          <span className="btn-text">Добавить</span>
        </button>
      </div>
      {(d.dated || d.title) && <Fields d={d} set={setD} tags={tags} canShare={!!data.household} today={today} compact allowRemind />}
      {d.dated && d.remind && (
        <Link
          className="add-line"
          style={{ padding: 0 }}
          href={`/tasks?new=1&title=${encodeURIComponent(d.title)}&date=${d.due}&time=${d.time}&tag=${encodeURIComponent(d.tag)}`}
        >
          Больше настроек: несколько времён, чек-лист, повтор, если не отметили
        </Link>
      )}
    </form>
  );
}

function EditDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { data, reload, now, toast } = useApp();
  const today = localDay(now);
  const [d, setD] = useState<Draft>(() => draftOf(task, today));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const phone = useIsPhone();
  useModalFocus(formRef);
  const tags = knownTags(data.tasks, data.reminders);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true);
    try {
      await api(`tasks/${task.id}`, 'PATCH', bodyOf(d, today));
      await reload();
      onClose();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api(`tasks/${task.id}`, 'DELETE');
      await reload();
      onClose();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  if (confirm) {
    return <Confirm title={`Удалить «${task.title}»?`} text="Дело удалится вместе с историей выполнения." action="Удалить" onCancel={() => setConfirm(false)} onConfirm={remove} />;
  }

  // На телефоне — окном снизу, как «Новое дело»; на компьютере — по центру.
  const fields = (
    <>
        <div className="fld">
          <label className="label" htmlFor="t-title">
            Что сделать
          </label>
          <input id="t-title" ref={titleRef} className="field" maxLength={200} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </div>
        <WhenSeg dated={d.dated} set={(v) => setD({ ...d, dated: v })} />
        <Fields d={d} set={setD} tags={tags} canShare={!!data.household} today={today} />
        <div className="fld">
          <label className="label" htmlFor="t-note">
            Заметка
          </label>
          <textarea id="t-note" className="field" rows={3} maxLength={2000} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </div>
        {task.author && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Общее дело, завёл(а) {task.author}.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!task.author && (
            <button className="btn btn-danger-ghost" type="button" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={18} />
              Удалить
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost hide-phone" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || !d.title.trim()}>
            <Icon name="check" size={18} />
            Сохранить
          </button>
        </div>
    </>
  );
  if (phone) {
    return (
      <Sheet title="Дело" onClose={onClose}>
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fields}
        </form>
      </Sheet>
    );
  }
  return (
    <div className="overlay" onClick={onClose}>
      <form ref={formRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="task-dlg" style={{ width: 'min(520px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 id="task-dlg" className="display" style={{ margin: 0, fontSize: 20 }}>
          Дело
        </h2>
        {fields}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- экран

/**
 * «Дела» — дела и напоминания одним списком по дням: просрочено, сегодня,
 * завтра, позже, без срока (src/lib/timeline.ts). Срок у дела — по желанию;
 * указали время — придёт push. «Быт по кругу» и все повторы — фильтрами
 * сверху; их списки, форма напоминания и окно по нажатию на push — из
 * src/components/Reminders.tsx во встроенном режиме.
 */
export default function Tasks() {
  const { data, now, setOpenList, mutate, reload, toast } = useApp();
  const { undo } = useTaskActions();
  const rem = useReminderActions();
  const router = useRouter();
  const phone = useIsPhone();
  const today = localDay(now);
  const [open, setOpen] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<'all' | 'chores' | 'repeat'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const params = useSearchParams();

  // Пришли из поиска: /tasks?open=<id> — открываем дело.
  useEffect(() => {
    const id = params.get('open');
    const t = id ? data.tasks.find((x) => x.id === id) : null;
    if (t) setOpen(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const tasks = data.tasks.filter((t) => !tag || t.tag === tag);
  const groups = timeline(tasks, data.reminders.filter((r) => !tag || r.tag === tag), today, new Set(data.done), data.snoozed);
  const doneToday = tasks.filter((t) => data.tasksDoneToday.includes(t.id) && t.done_at);
  const repeatedToday = tasks.filter((t) => data.tasksDoneToday.includes(t.id) && !t.done_at);
  const tags = knownTags(data.tasks, data.reminders);
  const editReminder = (id: string) => router.replace(`/tasks?edit=${encodeURIComponent(id)}`);
  const show = (v: 'all' | 'chores' | 'repeat', t: string | null = null) => {
    setView(v);
    setTag(t);
  };

  const remRow = (row: Extract<Row, { kind: 'rem' }>, group: string) => {
    const o = row.occ;
    const r = o.reminder;
    const isToday = group === 'today';
    const overdue = isToday && r.rule.kind === 'after' && !o.done && today > dueDay(r.rule, r.last_done);
    return (
      <Swipe
        key={row.key}
        onRight={isToday && !o.done ? () => rem.done(r, o.slot, true) : undefined}
        actions={[
          ...(isToday && !o.done ? [{ label: 'Через час', icon: 'clock', tone: 'warm' as const, onClick: () => rem.snooze(o, 60) }] : []),
          { label: 'Изменить', icon: 'edit', onClick: () => editReminder(r.id) },
        ]}
      >
        <div className="task-row">
          {isToday ? (
            <label className={`check round${o.done ? ' done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
              <input type="checkbox" checked={o.done} onChange={(e) => rem.done(r, o.slot, e.target.checked)} aria-label={r.title} />
              <button
                type="button"
                className="check-text task-open"
                onClick={(e) => {
                  e.preventDefault();
                  editReminder(r.id);
                }}
              >
                {r.title}
                {overdue && (
                  <span className="chip chip-danger" style={{ marginLeft: 6 }}>
                    давно пора
                  </span>
                )}
              </button>
            </label>
          ) : (
            <button type="button" className="check future" style={{ flex: 1, minWidth: 0 }} onClick={() => editReminder(r.id)}>
              <span className="future-dot" aria-hidden="true">
                <Icon name="bell" size={14} />
              </span>
              <span className="check-text">{r.title}</span>
            </button>
          )}
          <span className="row-meta">
            {r.tag && <span className="tag">{r.tag}</span>}
            {r.rule.kind !== 'once' && <Icon name="repeat" size={14} />}
            {group === 'later' && <span>{shortDate(row.date, today)} ·</span>}
            <span className={`mono row-time${group === 'today' && !o.done && minutesOf(row.time) < now.getHours() * 60 + now.getMinutes() ? ' late' : ''}`}>{row.time}</span>
          </span>
        </div>
      </Swipe>
    );
  };

  const totalOpen = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Дела
        </h1>
        {!phone && (
          <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            Новое дело
          </button>
        )}
      </div>

      <div className="chip-scroll" role="group" aria-label="Что показать" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="chip" type="button" aria-pressed={view === 'all' && !tag} onClick={() => show('all')}>
          Всё
        </button>
        <button className="chip" type="button" aria-pressed={view === 'chores'} onClick={() => show('chores')}>
          Быт по кругу
        </button>
        <button className="chip" type="button" aria-pressed={view === 'repeat'} onClick={() => show('repeat')}>
          Повторы
        </button>
        {tags.map((t) => (
          <button key={t} className="chip" type="button" aria-pressed={view === 'all' && tag === t} onClick={() => show('all', tag === t ? null : t)}>
            #{t}
          </button>
        ))}
      </div>

      {view === 'all' && (
        <div className="day-groups">
          {totalOpen === 0 && doneToday.length === 0 && <Empty icon="tasks" title="Дел нет — можно выдохнуть" action="Добавить дело" onAction={() => setAdding(true)} />}
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={`g-${g.id}`}>
              <h2 className="group-title day-title" id={`g-${g.id}`} data-tone={g.id === 'overdue' ? 'danger' : undefined}>
                {g.title}
                <span className="day-count">{g.rows.length}</span>
              </h2>
              {g.rows.map((row) =>
                row.kind === 'task' ? (
                  <TaskRow key={row.key} task={row.task} onOpen={setOpen} showDate={g.id === 'later'} hideDue={g.id === 'today' || g.id === 'tomorrow'} />
                ) : (
                  remRow(row, g.id)
                ),
              )}
            </section>
          ))}
          {doneToday.length + repeatedToday.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--muted)', minHeight: 32 }}>Сделано сегодня · {doneToday.length + repeatedToday.length}</summary>
              {doneToday.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
              {repeatedToday.map((t) => (
                <div key={t.id} className="task-row" style={{ gap: 8, padding: '4px 0 4px 12px', fontSize: 14, color: 'var(--muted)' }}>
                  <Icon name="repeat" size={14} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {t.title} — следующий раз {dueLabel(t.due_date, today)?.text}
                  </span>
                  <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => undo(t)}>
                    Вернуть
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}

      {/* Списки «Быт по кругу» / «Повторы» и окна напоминаний (правка, push, удаление). */}
      <Reminders
        data={data}
        mutate={mutate}
        reload={reload}
        now={now}
        toast={toast}
        embedded={view === 'chores' ? 'chores' : view === 'repeat' ? 'all' : 'sheets'}
        base="/tasks"
        onOpenChecklist={(id) => {
          setOpenList(id);
          router.push('/lists');
        }}
      />

      {phone && <Fab label="Новое дело" onClick={() => setAdding(true)} />}
      {adding && (
        <Sheet title="Новое дело" onClose={() => setAdding(false)}>
          <AddTask autoFocus onDone={() => setAdding(false)} />
        </Sheet>
      )}
      {open && <EditDialog task={open} onClose={() => setOpen(null)} />}
    </>
  );
}
