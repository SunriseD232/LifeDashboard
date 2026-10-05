'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { agendaFor } from '@/lib/agenda';
import { api } from '@/lib/api';
import { localDay, minutesOf } from '@/lib/dates';
import { occurrenceKey, occurrencesOn, type Occurrence } from '@/lib/occurrences';
import { addDays, dueDay } from '@/lib/recur';
import { knownTags, shortDate, type Task } from '@/lib/tasks';
import { sortTasks, timeline, type Row } from '@/lib/timeline';
import type { Priority, Reminder } from '@/lib/types';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import Empty from './Empty';
import { Icon } from './icons';
import { dayHead, WeekStrip } from './MiniCalendar';
import { Fab, Sheet, useIsPhone } from './Phone';
import { useReminderActions } from './reminderActions';
import Swipe from './Swipe';
import TaskDialog, { PriorityFlag, type DialogTarget } from './TaskDialog';

// ---------------------------------------------------------------- действия

/** Отметить / снять отметку у задачи без напоминания. */
export function useTaskActions() {
  const { mutate, now, toast } = useApp();
  const today = localDay(now);

  const complete = (t: Task) => {
    // Короткий отклик пальцу (Android; iPhone вибрацию сайтам не даёт).
    navigator.vibrate?.(12);
    mutate(
      (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done_at: today } : x)), tasksDoneToday: [...d.tasksDoneToday.filter((x) => x !== t.id), t.id] }),
      () => api(`tasks/${t.id}/done`, 'POST', { day: today }),
    );
    toast(`Сделано: «${t.title}»`, () => undo(t));
  };

  function undo(t: Task) {
    mutate(
      (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done_at: null } : x)), tasksDoneToday: d.tasksDoneToday.filter((x) => x !== t.id) }),
      () => api(`tasks/${t.id}/undo`, 'POST', { day: today }),
    );
  }

  const remove = (t: Task) => {
    mutate(
      (d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }),
      () => api(`tasks/${t.id}`, 'DELETE'),
    );
    toast(`Удалено: «${t.title}»`);
  };

  return { complete, undo, remove, today };
}

/**
 * Перенос по дням свайпом: задача без напоминания «на завтра» становится
 * задачей с напоминанием (время — из настроек); разовую можно сдвинуть на
 * завтра или убрать дату — тогда она снова просто в списке.
 */
export function useDateMoves() {
  const { data, mutate, reload, now, toast } = useApp();
  const today = localDay(now);
  const tomorrow = addDays(today, 1);
  const at = data.settings.deadline_time;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    }
    await reload();
  };
  const remBody = (x: { title: string; tags: string[]; priority: Priority; note: string | null; checklist_id: string | null }, date: string, times = [at]) => ({
    title: x.title.slice(0, 120),
    times,
    rule: { kind: 'once', date },
    tags: x.tags,
    priority: x.priority,
    note: x.note,
    checklist_id: x.checklist_id,
  });
  const taskBody = (x: { title: string; tags: string[]; priority: Priority; note: string | null; checklist_id: string | null }) => ({
    title: x.title,
    tags: x.tags,
    priority: x.priority,
    note: x.note,
    checklist_id: x.checklist_id,
  });

  /** Задача без даты → напоминание на завтра. */
  const taskTomorrow = (t: Task) => {
    mutate(
      (d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }),
      () =>
        run(async () => {
          const { id } = await api<{ id: string }>('reminders', 'POST', remBody(t, tomorrow));
          await api(`tasks/${t.id}`, 'DELETE');
          toast(`«${t.title}» — завтра в ${at}`, () =>
            run(async () => {
              await api('tasks', 'POST', taskBody(t));
              await api(`reminders/${id}`, 'DELETE');
            }),
          );
        }),
    );
  };

  /** Разовую — на завтра (время то же). */
  const remTomorrow = (r: Reminder) => {
    const was = r.rule;
    mutate(
      (d) => ({ ...d, reminders: d.reminders.map((x) => (x.id === r.id ? { ...x, rule: { kind: 'once', date: tomorrow } } : x)) }),
      () => api(`reminders/${r.id}`, 'PATCH', { rule: { kind: 'once', date: tomorrow } }),
    );
    toast(`«${r.title}» — на завтра`, () =>
      mutate(
        (d) => ({ ...d, reminders: d.reminders.map((x) => (x.id === r.id ? { ...x, rule: was } : x)) }),
        () => api(`reminders/${r.id}`, 'PATCH', { rule: was }),
      ),
    );
  };

  /** Убрать дату: напоминание → задача в списке «Без напоминания». */
  const remUndate = (r: Reminder) => {
    mutate(
      (d) => ({ ...d, reminders: d.reminders.filter((x) => x.id !== r.id) }),
      () =>
        run(async () => {
          const { id } = await api<{ id: string }>('tasks', 'POST', taskBody(r));
          await api(`reminders/${r.id}`, 'DELETE');
          toast(`«${r.title}» — без даты`, () =>
            run(async () => {
              await api('reminders', 'POST', { ...remBody(r, r.rule.kind === 'once' ? r.rule.date : today, r.times), rule: r.rule, nag: r.nag });
              await api(`tasks/${id}`, 'DELETE');
            }),
          );
        }),
    );
  };

  return { taskTomorrow, remTomorrow, remUndate, tomorrow };
}

// ---------------------------------------------------------------- строки

/** Метки, чек-лист, «общая» — подписи под названием. */
function Meta({ tags, checklistId, shared, author }: { tags: string[]; checklistId: string | null; shared?: boolean; author?: string | null }) {
  const { data } = useApp();
  const list = checklistId ? data.checklists.find((c) => c.id === checklistId) : null;
  if (!tags.length && !list && !shared) return null;
  return (
    <span className="row-tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          #{t}
        </span>
      ))}
      {list && (
        <span className="tag" title={`Чек-лист «${list.title}»`}>
          <Icon name="list" size={12} />
          {list.title}
        </span>
      )}
      {shared && (
        <span className="tag" title={author ? `Общая, завёл(а) ${author}` : 'Общая задача семьи'}>
          <Icon name="users" size={12} /> {author ?? 'общая'}
        </span>
      )}
    </span>
  );
}

export function TaskRow({ task, onOpen }: { task: Task; onOpen?: (t: Task) => void }) {
  const { complete, undo, remove } = useTaskActions();
  const moves = useDateMoves();
  const done = !!task.done_at;
  // Чужую общую задачу удалить нельзя (сервер не даст) — и свайп не предлагает.
  const canDelete = !task.household_id || !task.author;
  const body = (
    <>
      <span className="row-title">
        <PriorityFlag p={task.priority} />
        {task.title}
      </span>
      <Meta tags={task.tags} checklistId={task.checklist_id} shared={!!task.household_id} author={task.author} />
    </>
  );
  return (
    <Swipe
      onRight={done ? undefined : () => complete(task)}
      actions={
        done
          ? []
          : [
              // Общую задачу семьи в напоминание не превратить: push — одному человеку.
              ...(!task.household_id ? [{ label: 'Завтра', icon: 'calendar', tone: 'warm' as const, onClick: () => moves.taskTomorrow(task) }] : []),
              ...(canDelete ? [{ label: 'Удалить', icon: 'trash', tone: 'danger' as const, onClick: () => remove(task) }] : []),
            ]
      }
    >
      <div className="task-row">
        <label className={`check round${done ? ' done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
          <input type="checkbox" checked={done} onChange={(e) => (e.target.checked ? complete(task) : undo(task))} aria-label={task.title} />
          {/* Кружок — отметить; текст — открыть задачу (кнопка внутри label галочку не ставит). */}
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
      </div>
    </Swipe>
  );
}

/**
 * Задача с напоминанием в свой день. Отметить можно сегодняшнюю и
 * просроченную (отметка ляжет на сегодня); будущую — только открыть.
 */
export function ReminderRow({ occ, date, time, onOpen, overdue, hideDate }: { occ: Occurrence; date: string; time: string; onOpen: (r: Reminder) => void; overdue?: boolean; hideDate?: boolean }) {
  const rem = useReminderActions();
  const moves = useDateMoves();
  const { now } = useApp();
  const today = localDay(now);
  const r = occ.reminder;
  const checkable = date === today || !!overdue;
  const late = date === today && !occ.done && minutesOf(time) < now.getHours() * 60 + now.getMinutes();
  const chore = date === today && r.rule.kind === 'after' && !occ.done && today > dueDay(r.rule, r.last_done);
  const body = (
    <>
      <span className="row-title">
        <PriorityFlag p={r.priority} />
        {r.title}
        {chore && <span className="chip chip-danger">давно пора</span>}
      </span>
      <Meta tags={r.tags} checklistId={r.checklist_id} />
    </>
  );
  return (
    <Swipe
      onRight={checkable && !occ.done ? () => rem.done(r, occ.slot, true) : undefined}
      actions={[
        ...(date === today && !occ.done ? [{ label: 'Через час', icon: 'clock', tone: 'warm' as const, onClick: () => rem.snooze(occ, 60) }] : []),
        // Разовую — на завтра или без даты; повтор меняют в окне задачи.
        ...(r.rule.kind === 'once'
          ? [
              ...(r.rule.date !== moves.tomorrow ? [{ label: 'Завтра', icon: 'calendar', onClick: () => moves.remTomorrow(r) }] : []),
              { label: 'Без даты', icon: 'tasks', onClick: () => moves.remUndate(r) },
            ]
          : [{ label: 'Изменить', icon: 'edit', onClick: () => onOpen(r) }]),
      ]}
    >
      <div className="task-row">
        {checkable ? (
          <label className={`check round${occ.done ? ' done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
            <input type="checkbox" checked={occ.done} onChange={(e) => rem.done(r, occ.slot, e.target.checked)} aria-label={r.title} />
            <button
              type="button"
              className="check-text task-open"
              onClick={(e) => {
                e.preventDefault();
                onOpen(r);
              }}
            >
              {body}
            </button>
          </label>
        ) : (
          <button type="button" className="check future" style={{ flex: 1, minWidth: 0 }} onClick={() => onOpen(r)}>
            <span className="future-dot" aria-hidden="true">
              <Icon name="bell" size={14} />
            </span>
            <span className="check-text task-open">{body}</span>
          </button>
        )}
        <span className="row-meta">
          {r.rule.kind !== 'once' && <Icon name="repeat" size={14} />}
          {!hideDate && (overdue || date > addDays(today, 1)) && <span>{shortDate(date, today)} ·</span>}
          <span className={`mono row-time${late || overdue ? ' late' : ''}`}>{time}</span>
        </span>
      </div>
    </Swipe>
  );
}

// ---------------------------------------------------------------- фильтры

interface Filter {
  tag: string | null;
  /** Не ниже этой важности; 0 — любая. */
  prio: Priority;
}
const FILTER_KEY = 'lifedashboard:tasks-filter';

function loadFilter(): Filter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null') as Filter | null;
    if (f && typeof f === 'object') return { tag: typeof f.tag === 'string' ? f.tag : null, prio: [0, 1, 2, 3].includes(f.prio) ? f.prio : 0 };
  } catch {
    /* приватный режим */
  }
  return { tag: null, prio: 0 };
}

const PRIO_FILTERS: { v: Priority; label: string }[] = [
  { v: 0, label: 'Любая важность' },
  { v: 3, label: 'Только высокая' },
  { v: 2, label: 'Средняя и выше' },
  { v: 1, label: 'С любой отметкой' },
];

/** Свои метки: переименовать, удалить (уберётся и из задач), добавить. */
function TagManager({ onClose }: { onClose: () => void }) {
  const { data, reload, toast } = useApp();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(data.tags.map((t) => [t, t])));
  const [fresh, setFresh] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await reload();
      toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (confirm) {
    return (
      <Confirm
        title={`Удалить метку «${confirm}»?`}
        text="Метка уберётся и у всех задач, сами задачи останутся."
        action="Удалить"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const t = confirm;
          setConfirm(null);
          run(() => api('tags/delete', 'POST', { name: t }), `Метка «${t}» удалена`);
        }}
      />
    );
  }
  return (
    <Sheet title="Метки" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.tags.length === 0 && <p style={{ margin: 0, color: 'var(--muted)' }}>Меток пока нет. Добавьте здесь или прямо в задаче.</p>}
        {data.tags.map((t) => (
          <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="sr-only" htmlFor={`tag-${t}`}>
              Название метки {t}
            </label>
            <input
              id={`tag-${t}`}
              className="field"
              style={{ flex: 1 }}
              maxLength={30}
              value={names[t] ?? t}
              onChange={(e) => setNames({ ...names, [t]: e.target.value })}
              onBlur={() => {
                const to = (names[t] ?? t).trim();
                if (to && to !== t) run(() => api('tags/rename', 'POST', { from: t, to }), 'Метка переименована');
              }}
            />
            <button className="icon-btn bare" type="button" aria-label={`Удалить метку «${t}»`} onClick={() => setConfirm(t)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = fresh.trim().replace(/^#/, '');
            if (!n) return;
            setFresh('');
            run(() => api('tags', 'POST', { name: n }), `Метка «${n}» добавлена`);
          }}
        >
          <label className="sr-only" htmlFor="tag-fresh">
            Новая метка
          </label>
          <input id="tag-fresh" className="field" style={{ flex: 1 }} maxLength={30} placeholder="Новая метка" value={fresh} onChange={(e) => setFresh(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!fresh.trim()}>
            <Icon name="plus" size={18} />
            <span className="btn-text">Добавить</span>
          </button>
        </form>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- push

/**
 * Нажали на push: ?focus=<id>&slot=09:00 — показываем задачу крупно, с
 * кнопкой «Сделано» (на iPhone в уведомлении её нет).
 */
function PushFocus({ onClose }: { onClose: () => void }) {
  const { data, now, toast } = useApp();
  const params = useSearchParams();
  const rem = useReminderActions();
  const today = localDay(now);
  const todays = occurrencesOn(data.reminders, today, new Set(data.done), data.snoozed);
  const id = params.get('focus');
  const slot = params.get('slot');
  const reminder = id ? data.reminders.find((r) => r.id === id) : undefined;
  const focus = id ? todays.find((o) => o.reminder.id === id && (!slot || o.slot === slot)) ?? todays.find((o) => o.reminder.id === id) : undefined;
  const list = reminder?.checklist_id ? data.checklists.find((c) => c.id === reminder.checklist_id) : null;
  return (
    <Sheet title="Напоминание" onClose={onClose}>
      {!reminder ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Этой задачи уже нет.</p>
      ) : !focus ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>«{reminder.title}» сегодня уже не по плану.</p>
      ) : (
        <div className="focus-card">
          <span className="mono" style={{ fontSize: 'calc(15px * var(--fs))', color: 'var(--muted)' }}>
            {focus.snoozedTo ?? focus.slot}
          </span>
          <p className="display focus-title">{reminder.title}</p>
          {list && (
            <span className="tag">
              <Icon name="list" size={12} />
              Чек-лист «{list.title}»
            </span>
          )}
          {focus.done ? (
            <p style={{ margin: 0, color: 'var(--accent-ink)', fontWeight: 600 }}>Уже отмечено — сделано.</p>
          ) : (
            <>
              <button
                className="btn btn-primary focus-done"
                type="button"
                onClick={() => {
                  rem.done(reminder, focus.slot, true, true);
                  toast('Сделано');
                  onClose();
                }}
              >
                <Icon name="check" size={22} />
                Сделано
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {[15, 60].map((m) => (
                  <button
                    key={m}
                    className="btn btn-ghost"
                    type="button"
                    style={{ flex: 1 }}
                    onClick={() => {
                      rem.snooze(focus, m);
                      onClose();
                    }}
                  >
                    <Icon name="clock" size={18} />
                    {m < 60 ? `Через ${m} мин` : 'Через час'}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

const NOTIFIED_KEY = 'lifedashboard:notified';
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Пока вкладка открыта — тост «Пора: …» в момент напоминания (push шлёт сервер). */
function useDueToasts() {
  const { data, now, toast } = useApp();
  useEffect(() => {
    const today = localDay(now);
    const cur = hm(now.getHours() * 60 + now.getMinutes());
    let shown: string[] = [];
    try {
      shown = JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || '[]');
    } catch {
      shown = [];
    }
    for (const o of occurrencesOn(data.reminders, today, new Set(data.done), data.snoozed)) {
      const t = o.snoozedTo ?? o.slot;
      const key = `${today}:${o.key}:${t}`;
      if (o.done || t !== cur || shown.includes(key)) continue;
      shown.push(key);
      toast(`Пора: ${o.reminder.title}`);
    }
    try {
      sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(shown.slice(-100)));
    } catch {
      /* приватный режим */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);
}

// ---------------------------------------------------------------- экран

/**
 * «Задачи»: с напоминанием — по дням (просрочено, сегодня, завтра, позже),
 * без напоминания — списком, важные сверху (src/lib/timeline.ts). Сверху —
 * фильтры по метке и важности (запоминаются), сбоку — календарь (на
 * телефоне — лента недели): нажали день — видно задачи этого дня.
 * Добавить — одной кнопкой: окно TaskDialog.
 */
export default function Tasks() {
  const { data, now } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const phone = useIsPhone();
  const today = localDay(now);
  const [dialog, setDialog] = useState<DialogTarget>(null);
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilterState] = useState<Filter>({ tag: null, prio: 0 });
  const [managing, setManaging] = useState(false);
  useDueToasts();

  useEffect(() => setFilterState(loadFilter()), []);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(f));
    } catch {
      /* приватный режим */
    }
  };

  // Пришли из поиска, с Главной или по старым ссылкам: ?open=<задача>,
  // ?edit=<напоминание>, ?new=1[&date=…&time=…&title=…].
  useEffect(() => {
    const open = params.get('open');
    const edit = params.get('edit');
    const t = open ? data.tasks.find((x) => x.id === open) : null;
    const r = edit ? data.reminders.find((x) => x.id === edit) : null;
    if (t) setDialog({ task: t });
    else if (r) setDialog({ reminder: r });
    else if (params.get('new')) setDialog({ day: params.get('date') ?? undefined, time: params.get('time') ?? undefined, title: params.get('title') ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const closeDialog = () => {
    setDialog(null);
    if (params.get('open') || params.get('edit') || params.get('new')) router.replace('/tasks');
  };

  const tags = knownTags(data.tags, data.tasks, data.reminders);
  // Спрятали поле шестерёнкой в окне задачи — прячем и его фильтр.
  const useTags = !data.settings.task_hidden.includes('tags');
  const usePrio = !data.settings.task_hidden.includes('priority');
  const tag = useTags && filter.tag && tags.includes(filter.tag) ? filter.tag : null;
  const prio = usePrio ? filter.prio : 0;
  const pass = (x: { tags: string[]; priority: Priority }) => (!tag || x.tags.includes(tag)) && x.priority >= prio;
  const tasks = data.tasks.filter(pass);
  const reminders = data.reminders.filter(pass);
  const doneSet = useMemo(() => new Set(data.done), [data.done]);
  const groups = timeline(tasks, reminders, today, doneSet, data.snoozed);
  const dots = (d: string) => agendaFor(d, reminders, today, doneSet);
  const doneToday = tasks.filter((t) => data.tasksDoneToday.includes(t.id) && t.done_at);
  const filtered = !!tag || prio > 0;

  const open = (r: Reminder) => setDialog({ reminder: r });
  const row = (r: Row, overdue = false, hideDate = false) =>
    r.kind === 'task' ? (
      <TaskRow key={r.key} task={r.task} onOpen={(t) => setDialog({ task: t })} />
    ) : (
      <ReminderRow key={r.key} occ={r.occ} date={r.date} time={r.time} onOpen={open} overdue={overdue} hideDate={hideDate} />
    );

  // Выбранный в календаре день: его задачи с напоминанием (сегодня — с галочками).
  const dayRows = (d: string): Row[] => {
    if (d === today) return groups.find((g) => g.id === 'today')?.rows ?? [];
    return agendaFor(d, reminders, today).map((i) => {
      const r = reminders.find((x) => x.id === i.id)!;
      return { kind: 'rem', key: i.key, occ: { reminder: r, slot: i.time, key: occurrenceKey(r.id, i.time), done: false, snoozedTo: null }, date: d, time: i.time };
    });
  };

  const filters = (useTags || usePrio) && (
    <div className="task-filters" data-tour="tasks-filters">
      {useTags && (
        <div className="chip-scroll" role="group" aria-label="Метки">
          <button className="chip" type="button" aria-pressed={!tag} onClick={() => setFilter({ ...filter, tag: null })}>
            Все метки
          </button>
          {tags.map((t) => (
            <button key={t} className="chip" type="button" aria-pressed={tag === t} onClick={() => setFilter({ ...filter, tag: tag === t ? null : t })}>
              #{t}
            </button>
          ))}
          <button className="chip" type="button" onClick={() => setManaging(true)}>
            <Icon name="edit" size={14} />
            {tags.length ? 'Метки' : 'Добавить метки'}
          </button>
        </div>
      )}
      {usePrio && (
        <>
          <label className="sr-only" htmlFor="prio-filter">
            Важность
          </label>
          <select id="prio-filter" className="field prio-select" data-on={filter.prio > 0 || undefined} value={filter.prio} onChange={(e) => setFilter({ ...filter, prio: Number(e.target.value) as Priority })}>
            {PRIO_FILTERS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.label}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );

  const rowsOfDay = day ? dayRows(day) : [];
  const list = day ? (
    <section aria-labelledby="day-head">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className="group-title day-title" id="day-head" style={{ flex: 1 }}>
          {dayHead(day, today)}
        </h2>
        {day >= today && (
          <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => setDialog({ day })}>
            <Icon name="plus" size={16} />
            На этот день
          </button>
        )}
        <button className="icon-btn bare" type="button" aria-label="Показать все задачи" title="Все задачи" onClick={() => setDay(null)}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {rowsOfDay.length === 0 ? <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>На этот день ничего нет.</p> : rowsOfDay.map((r) => row(r, false, true))}
    </section>
  ) : (
    <div className="day-groups">
      {groups.length === 0 &&
        doneToday.length === 0 &&
        (filtered ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            По этому фильтру задач нет.{' '}
            <button className="add-line" type="button" style={{ display: 'inline', padding: 0 }} onClick={() => setFilter({ tag: null, prio: 0 })}>
              Сбросить фильтр
            </button>
          </p>
        ) : (
          <Empty icon="tasks" title="Задач нет — можно выдохнуть" action="Добавить задачу" onAction={() => setDialog({})} />
        ))}
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`g-${g.id}`}>
          <h2 className="group-title day-title" id={`g-${g.id}`} data-tone={g.id === 'overdue' ? 'danger' : undefined}>
            {g.title}
            <span className="day-count">{g.rows.length}</span>
          </h2>
          {g.rows.map((r) => row(r, g.id === 'overdue'))}
        </section>
      ))}
      {doneToday.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 'calc(14px * var(--fs))', fontWeight: 600, color: 'var(--muted)', minHeight: 32 }}>Сделано сегодня · {doneToday.length}</summary>
          {sortTasks(doneToday).map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </details>
      )}
    </div>
  );

  const pickDay = (d: string) => setDay(d === day ? null : d);

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Задачи
        </h1>
        {!phone && (
          <button className="btn btn-primary" type="button" onClick={() => setDialog(day && day >= today ? { day } : {})}>
            <Icon name="plus" size={18} />
            Добавить задачу
          </button>
        )}
      </div>

      <div className="tasks-layout">
        <div className="tasks-main">
          {phone && <WeekStrip key="week" sel={day ?? today} today={today} onPick={pickDay} dots={dots} />}
          {filters}
          {list}
        </div>
        {!phone && (
          <aside className="tasks-side">
            <section className="card" aria-label="Календарь задач">
              <WeekStrip key="month" sel={day ?? today} today={today} onPick={pickDay} dots={dots} alwaysMonth />
              <p style={{ margin: 0, fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' }}>
                {day ? (
                  <button className="add-line" type="button" style={{ padding: 0 }} onClick={() => setDay(null)}>
                    Показать все задачи
                  </button>
                ) : (
                  'Точки — задачи с напоминанием. Нажмите день — покажу его задачи.'
                )}
              </p>
            </section>
          </aside>
        )}
      </div>

      {phone && <Fab label="Добавить задачу" onClick={() => setDialog(day && day >= today ? { day } : {})} />}
      {dialog && <TaskDialog key={'task' in dialog ? dialog.task.id : 'reminder' in dialog ? dialog.reminder.id : 'new'} target={dialog} onClose={closeDialog} />}
      {managing && <TagManager onClose={() => setManaging(false)} />}
      {params.get('focus') && <PushFocus onClose={() => router.replace('/tasks')} />}
    </>
  );
}
