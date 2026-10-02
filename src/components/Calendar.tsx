'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { agendaFor, monthGrid, type AgendaItem } from '@/lib/agenda';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { addDays } from '@/lib/recur';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { Fab, Sheet, useIsPhone } from './Phone';

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const monthTitle = (month: string) => {
  const s = asDate(month).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dayHead = (day: string, today: string) => {
  const s = asDate(day).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const rel = day === today ? 'Сегодня, ' : day === addDays(today, 1) ? 'Завтра, ' : '';
  return rel ? rel + s.split(', ')[1] : s.charAt(0).toUpperCase() + s.slice(1);
};
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
const mondayOf = (day: string) => addDays(day, -((asDate(day).getDay() + 6) % 7));

/**
 * Календарь: месяц (точки — что есть в день) и неделя списком. Видно и
 * будущие разы повторов. «+» — дело или напоминание сразу на выбранный день.
 */
export default function Calendar() {
  const { data, now } = useApp();
  const phone = useIsPhone();
  const today = localDay(now);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [month, setMonth] = useState(firstOfMonth(today));
  const [sel, setSel] = useState(today);
  const [adding, setAdding] = useState(false);
  const done = useMemo(() => new Set(data.done), [data.done]);
  const agenda = useMemo(() => {
    const cache = new Map<string, AgendaItem[]>();
    return (day: string) => {
      if (!cache.has(day)) cache.set(day, agendaFor(day, data.tasks, data.reminders, today, done));
      return cache.get(day)!;
    };
  }, [data.tasks, data.reminders, today, done]);

  const pick = (day: string) => {
    setSel(day);
    if (firstOfMonth(day) !== month) setMonth(firstOfMonth(day));
  };
  const weekStart = mondayOf(sel);

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Календарь
        </h1>
        <div className="tabs-row" role="group" aria-label="Вид">
          <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>
            Месяц
          </button>
          <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>
            Неделя
          </button>
        </div>
        {!phone && (
          <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            На {sel === today ? 'сегодня' : asDate(sel).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          </button>
        )}
      </div>

      {view === 'month' ? (
        <div className="cal-layout">
          <section className="card cal-month" aria-label={monthTitle(month)}>
            <div className="cal-nav">
              <button className="icon-btn bare" type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
                <Icon name="back" size={18} />
              </button>
              <h2 className="card-title display" style={{ flex: 1, justifyContent: 'center' }}>
                {monthTitle(month)}
              </h2>
              <button className="icon-btn bare" type="button" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))} style={{ transform: 'scaleX(-1)' }}>
                <Icon name="back" size={18} />
              </button>
            </div>
            <div className="cal-grid" role="grid">
              {WEEK.map((w) => (
                <span key={w} className="cal-wd" role="columnheader">
                  {w}
                </span>
              ))}
              {monthGrid(month)
                .flat()
                .map((day) => {
                  const items = agenda(day);
                  const outside = firstOfMonth(day) !== month;
                  return (
                    <button
                      key={day}
                      type="button"
                      role="gridcell"
                      className="cal-day"
                      data-out={outside || undefined}
                      data-today={day === today || undefined}
                      aria-selected={day === sel}
                      aria-label={`${dayHead(day, today)}${items.length ? `, дел: ${items.length}` : ''}`}
                      onClick={() => pick(day)}
                    >
                      <span className="cal-num">{Number(day.slice(8))}</span>
                      <span className="cal-dots" aria-hidden="true">
                        {items.slice(0, 3).map((i) => (
                          <i key={i.key} data-kind={i.kind} data-done={i.done || undefined} />
                        ))}
                      </span>
                    </button>
                  );
                })}
            </div>
            {sel !== today && (
              <button className="add-line" type="button" style={{ alignSelf: 'center' }} onClick={() => pick(today)}>
                К сегодняшнему дню
              </button>
            )}
          </section>
          <DayList day={sel} today={today} items={agenda(sel)} />
        </div>
      ) : (
        <div style={{ maxWidth: 720 }}>
          <div className="cal-nav" style={{ marginBottom: 8 }}>
            <button className="icon-btn bare" type="button" aria-label="Предыдущая неделя" onClick={() => pick(addDays(weekStart, -7))}>
              <Icon name="back" size={18} />
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
              {asDate(weekStart).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — {asDate(addDays(weekStart, 6)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
            </span>
            <button className="icon-btn bare" type="button" aria-label="Следующая неделя" onClick={() => pick(addDays(weekStart, 7))} style={{ transform: 'scaleX(-1)' }}>
              <Icon name="back" size={18} />
            </button>
          </div>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day) => (
            <DayList key={day} day={day} today={today} items={agenda(day)} compact onAdd={() => {
                setSel(day);
                setAdding(true);
              }} />
          ))}
        </div>
      )}

      {phone && <Fab label="Добавить на выбранный день" onClick={() => setAdding(true)} />}
      {adding && <AddOnDay day={sel} today={today} onClose={() => setAdding(false)} />}
    </>
  );
}

function DayList({ day, today, items, compact, onAdd }: { day: string; today: string; items: AgendaItem[]; compact?: boolean; onAdd?: () => void }) {
  return (
    <section className={compact ? 'cal-week-day' : 'card cal-list'} aria-label={dayHead(day, today)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className={compact ? 'group-title' : 'card-title display'} style={compact ? { padding: 0, flex: 1, color: day === today ? 'var(--accent-ink)' : undefined } : { flex: 1 }}>
          {dayHead(day, today)}
        </h2>
        {onAdd && (
          <button className="icon-btn bare" type="button" aria-label={`Добавить на ${dayHead(day, today)}`} onClick={onAdd}>
            <Icon name="plus" size={18} />
          </button>
        )}
      </div>
      {items.length === 0 ? (
        !compact && <p style={{ margin: 0, color: 'var(--muted)' }}>Ничего не запланировано.</p>
      ) : (
        <ul className="cal-items">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.kind === 'task' ? `/tasks?open=${i.id}` : `/reminders?edit=${i.id}`} className="cal-item" data-done={i.done || undefined}>
                <span className="mono cal-time">{i.time ?? ''}</span>
                <Icon name={i.kind === 'task' ? 'tasks' : 'bell'} size={16} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{i.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** «+» на день: дело со сроком или разовое напоминание на время. */
function AddOnDay({ day, today, onClose }: { day: string; today: string; onClose: () => void }) {
  const { reload, toast } = useApp();
  const [kind, setKind] = useState<'task' | 'reminder'>('task');
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      if (kind === 'task') await api('tasks', 'POST', { title: title.trim(), due_date: day < today ? today : day });
      else await api('reminders', 'POST', { title: title.trim(), times: [time], rule: { kind: 'once', date: day < today ? today : day }, checklist_id: null });
      await reload();
      toast(kind === 'task' ? 'Дело добавлено' : 'Напоминание добавлено');
      onClose();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={dayHead(day, today)} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="tabs-row" role="group" aria-label="Что добавить">
          <button type="button" aria-pressed={kind === 'task'} onClick={() => setKind('task')}>
            Дело
          </button>
          <button type="button" aria-pressed={kind === 'reminder'} onClick={() => setKind('reminder')}>
            Напоминание
          </button>
        </div>
        <label className="sr-only" htmlFor="cal-title">
          Что
        </label>
        <input id="cal-title" className="field" maxLength={200} placeholder={kind === 'task' ? 'Что сделать к этому дню' : 'О чём напомнить'} value={title} onChange={(e) => setTitle(e.target.value)} />
        {kind === 'reminder' && (
          <div className="fld" style={{ maxWidth: 160 }}>
            <label className="label" htmlFor="cal-time">
              Во сколько
            </label>
            <input id="cal-time" className="field mono" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !title.trim()}>
          <Icon name="plus" size={18} />
          Добавить
        </button>
      </form>
    </Sheet>
  );
}
