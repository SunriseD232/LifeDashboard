'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { localDay, plural } from '@/lib/dates';
import { describe, type Rule } from '@/lib/recur';
import { bucket, dueLabel, firstDue, groupLater, nextDue, shortDate, sortUrgent, type Task } from '@/lib/tasks';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';
import { PhoneForm } from './Phone';

// ---------------------------------------------------------------- действия

/** Отметить / снять отметку. Повторяющееся дело переезжает на следующий срок. */
export function useTaskActions() {
  const { mutate, reload, now, toast } = useApp();
  const today = localDay(now);

  const complete = (t: Task) => {
    const next = t.rule ? nextDue(t.rule, t.due_date, today) : null;
    mutate(
      (d) => ({
        ...d,
        tasks: d.tasks.map((x) => (x.id === t.id ? (next ? { ...x, due_date: next } : { ...x, done_at: today }) : x)),
        tasksDoneToday: [...d.tasksDoneToday.filter((x) => x !== t.id), t.id],
      }),
      () => api(`tasks/${t.id}/done`, 'POST', { day: today }),
    );
    if (next) toast(`Следующий раз — ${dueLabel(next, today)?.text}`);
  };

  const undo = (t: Task) =>
    mutate(
      (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done_at: null } : x)), tasksDoneToday: d.tasksDoneToday.filter((x) => x !== t.id) }),
      async () => {
        await api(`tasks/${t.id}/undo`, 'POST', { day: today });
        // Прежний срок повторяющегося дела знает сервер.
        await reload();
      },
    );

  return { complete, undo, today };
}

// ---------------------------------------------------------------- строка дела

const TONE: Record<string, string> = { danger: 'chip-danger', warm: 'chip-warm', muted: '' };

export function TaskRow({ task, onOpen, showDate = false }: { task: Task; onOpen?: (t: Task) => void; showDate?: boolean }) {
  const { complete, undo, today } = useTaskActions();
  const done = !!task.done_at;
  const due = dueLabel(task.due_date, today);
  return (
    <div className="task-row">
      <label className={`check round${done ? ' done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
        <input type="checkbox" checked={done} onChange={(e) => (e.target.checked ? complete(task) : undo(task))} aria-label={task.title} />
        {showDate && task.due_date && (
          <span className="mono" style={{ fontSize: 13, color: 'var(--muted)', width: 60, flex: 'none' }}>
            {shortDate(task.due_date, today)}
          </span>
        )}
        <span className="check-text" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
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
          {!showDate && due && !done && <span className={`chip ${TONE[due.tone]}`}>{due.text}</span>}
        </span>
      </label>
      {onOpen && (
        <button className="icon-btn bare" type="button" aria-label={`Изменить «${task.title}»`} onClick={() => onOpen(task)}>
          <Icon name="edit" size={18} />
        </button>
      )}
    </div>
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
  };
}

function bodyOf(d: Draft, today: string) {
  const rule = d.dated ? ruleOf(d.repeat, d.n, d.due) : null;
  // У повторяющегося первый срок — ближайший подходящий день не раньше даты.
  const due = d.dated ? (rule ? firstDue(rule, d.due < today ? today : d.due) ?? d.due : d.due) : null;
  return { title: d.title.trim(), due_date: due, rule, tag: d.tag.trim() || null, shared: d.shared, note: d.note.trim() || null };
}

function Fields({ d, set, tags, canShare, today, compact }: { d: Draft; set: (d: Draft) => void; tags: string[]; canShare: boolean; today: string; compact?: boolean }) {
  return (
    <div className="task-fields" data-compact={compact ? 'true' : undefined}>
      {d.dated && (
        <>
          <div className="fld">
            <label className="label" htmlFor="t-due">
              Срок
            </label>
            <input id="t-due" className="field" type="date" min={today} value={d.due} onChange={(e) => e.target.value && set({ ...d, due: e.target.value })} />
          </div>
          <div className="fld">
            <label className="label" htmlFor="t-rep">
              Повтор
            </label>
            <select id="t-rep" className="field" value={d.repeat} onChange={(e) => set({ ...d, repeat: e.target.value as RepeatId })}>
              {REPEATS.map((r) => (
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
      {canShare && (
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
        <Icon name="flame" size={16} />
        Срочно
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
  const tags = [...new Set(data.tasks.map((t) => t.tag).filter(Boolean) as string[])];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true);
    try {
      await api('tasks', 'POST', bodyOf(d, today));
      await reload();
      setD({ ...draftOf(null, today), dated: d.dated, due: d.due });
      toast('Дело добавлено');
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
      {(d.dated || d.title) && <Fields d={d} set={setD} tags={tags} canShare={!!data.household} today={today} compact />}
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
  useModalFocus(formRef);
  const tags = [...new Set(data.tasks.map((t) => t.tag).filter(Boolean) as string[])];

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

  return (
    <div className="overlay" onClick={onClose}>
      <form ref={formRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="task-dlg" style={{ width: 'min(520px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 id="task-dlg" className="display" style={{ margin: 0, fontSize: 20 }}>
          Дело
        </h2>
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
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || !d.title.trim()}>
            <Icon name="check" size={18} />
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- экран

/**
 * Дела: «Срочно» (без даты, а также сегодня, завтра и просроченное) и «С
 * датами — позже», по группам сроков. На телефоне колонки — вкладками.
 */
export default function Tasks() {
  const { data, now } = useApp();
  const { undo } = useTaskActions();
  const today = localDay(now);
  const [open, setOpen] = useState<Task | null>(null);
  const [col, setCol] = useState<'urgent' | 'later'>('urgent');
  const [tag, setTag] = useState<string | null>(null);
  const params = useSearchParams();

  // Пришли из поиска: /tasks?open=<id> — открываем дело.
  useEffect(() => {
    const id = params.get('open');
    const t = id ? data.tasks.find((x) => x.id === id) : null;
    if (t) setOpen(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const all = data.tasks.filter((t) => !tag || t.tag === tag);
  const urgent = sortUrgent(all.filter((t) => bucket(t, today) === 'urgent'));
  const later = groupLater(all.filter((t) => bucket(t, today) === 'later'), today);
  const laterCount = later.reduce((n, g) => n + g.tasks.length, 0);
  const doneToday = all.filter((t) => data.tasksDoneToday.includes(t.id) && bucket(t, today) === 'done');
  const repeatedToday = all.filter((t) => data.tasksDoneToday.includes(t.id) && bucket(t, today) !== 'done');
  const tags = [...new Set(data.tasks.map((t) => t.tag).filter(Boolean) as string[])].sort();

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Дела
        </h1>
        {tags.length > 0 && (
          <div role="group" aria-label="Метки" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="chip" type="button" aria-pressed={!tag} onClick={() => setTag(null)}>
              Все
            </button>
            {tags.map((t) => (
              <button key={t} className="chip" type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <PhoneForm title="Новое дело" fab="Новое дело" render={(done, inSheet) => <AddTask autoFocus={inSheet} onDone={inSheet ? done : undefined} />} />

      <div className="tabs-row only-mobile-flex" role="group" aria-label="Список" style={{ marginTop: 16 }}>
        <button type="button" aria-pressed={col === 'urgent'} onClick={() => setCol('urgent')}>
          <Icon name="flame" size={16} />
          Срочно · {urgent.length}
        </button>
        <button type="button" aria-pressed={col === 'later'} onClick={() => setCol('later')}>
          <Icon name="calendar" size={16} />
          Позже · {laterCount}
        </button>
      </div>

      <div className="tasks-grid" data-col={col}>
        <section className="card urgent-col" aria-labelledby="urgent-title" style={{ borderColor: 'var(--danger-line)' }}>
          <div className="card-head hide-phone">
            <h2 className="card-title display" id="urgent-title" style={{ color: 'var(--danger)' }}>
              <Icon name="flame" />
              Срочно
            </h2>
            <span className="card-link" style={{ color: 'var(--muted)', fontWeight: 500 }}>
              {plural(urgent.length, 'дело', 'дела', 'дел')}
            </span>
          </div>
          <p className="hide-phone" style={{ margin: '-8px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Без даты — сделать как можно скорее. Сюда же переезжают дела за день до срока.
          </p>
          {urgent.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Срочного нет — можно выдохнуть.</p>
          ) : (
            <div>
              {urgent.map((t) => (
                <TaskRow key={t.id} task={t} onOpen={setOpen} />
              ))}
            </div>
          )}
          {doneToday.length + repeatedToday.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--muted)', minHeight: 32 }}>
                Сделано сегодня · {doneToday.length + repeatedToday.length}
              </summary>
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
        </section>

        <section className="card later-col" aria-labelledby="later-title">
          <div className="card-head hide-phone">
            <h2 className="card-title display" id="later-title">
              <Icon name="calendar" />С датами — позже
            </h2>
            <span className="card-link" style={{ color: 'var(--muted)', fontWeight: 500 }}>
              {plural(laterCount, 'дело', 'дела', 'дел')}
            </span>
          </div>
          <p className="hide-phone" style={{ margin: '-8px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            За день до срока дело само переедет в «Срочно» и пришлёт напоминание в {data.settings.deadline_time}.
          </p>
          {later.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Ничего не запланировано.</p>
          ) : (
            later.map((g) => (
              <div key={g.title}>
                <h3 className="group-title" style={{ padding: '10px 0 4px' }}>
                  {g.title}
                </h3>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setOpen} showDate />
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      {open && <EditDialog task={open} onClose={() => setOpen(null)} />}
    </>
  );
}
