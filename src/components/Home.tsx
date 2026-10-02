'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { dayTitle, localDay } from '@/lib/dates';
import { occurrenceKey, occurrencesOn } from '@/lib/occurrences';
import { bucket, shortDate, sortUrgent } from '@/lib/tasks';
import type { Reminder } from '@/lib/types';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { AddTask, TaskRow } from './Tasks';
import { WeatherCard } from './Weather';

/**
 * Главная: всё на сегодня одним взглядом — срочные дела, напоминания,
 * ближайшие сроки, погода, чек-листы. Карточки кухни, тренировок и заметок
 * появятся вместе с разделами.
 */
export default function Home() {
  const { data, mutate, now, setOpenList } = useApp();
  const router = useRouter();

  // Старые ссылки (в том числе из уже присланных push): /task#reminders.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#reminders') router.replace('/reminders');
    else if (hash === '#lists') router.replace('/lists');
  }, [router]);

  const hour = now.getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const today = localDay(now);
  const todays = occurrencesOn(data.reminders, today, new Set(data.done), data.snoozed);
  const urgent = sortUrgent(data.tasks.filter((t) => bucket(t, today) === 'urgent'));
  const upcoming = data.tasks
    .filter((t) => bucket(t, today) === 'later')
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    .slice(0, 5);

  const toggle = (r: Reminder, slot: string, value: boolean) => {
    const key = occurrenceKey(r.id, slot);
    mutate(
      (d) => ({
        ...d,
        done: value ? [...d.done, key] : d.done.filter((x) => x !== key),
        reminders: r.rule.kind === 'after' && value ? d.reminders.map((x) => (x.id === r.id ? { ...x, last_done: today } : x)) : d.reminders,
      }),
      () => api(`reminders/${r.id}/done`, 'PUT', { day: today, slot, done: value }),
    );
  };

  const openList = (id: string) => {
    setOpenList(id);
    router.push('/lists');
  };

  const urgentCard = (
    <section className="card" aria-labelledby="home-urgent">
      <div className="card-head">
        <h2 className="card-title display" id="home-urgent" style={{ color: 'var(--danger)' }}>
          <Icon name="flame" />
          Срочно
        </h2>
        <Link className="card-link" href="/tasks">
          Все дела <Icon name="arrow" size={16} />
        </Link>
      </div>
      {urgent.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Срочного нет.</p>
      ) : (
        <div>
          {urgent.slice(0, 6).map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          {urgent.length > 6 && (
            <Link className="card-link" href="/tasks" style={{ marginLeft: 0, marginTop: 8 }}>
              Ещё {urgent.length - 6} <Icon name="arrow" size={16} />
            </Link>
          )}
        </div>
      )}
    </section>
  );

  const todayCard = (
    <section className="card" aria-labelledby="home-today">
      <div className="card-head">
        <h2 className="card-title display" id="home-today">
          <Icon name="bell" />
          Сегодня
        </h2>
        <Link className="card-link" href="/reminders">
          Напоминания <Icon name="arrow" size={16} />
        </Link>
      </div>
      {todays.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Напоминаний на сегодня нет.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {todays.map((o) => (
            <label key={o.key} className={`check${o.done ? ' done' : ''}`}>
              <input type="checkbox" checked={o.done} onChange={(e) => toggle(o.reminder, o.slot, e.target.checked)} />
              <span className="mono" style={{ fontWeight: 500, width: 48, flex: 'none' }}>
                {o.snoozedTo ?? o.slot}
              </span>
              <span className="check-text">{o.reminder.title}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );

  const deadlinesCard = (
    <section className="card" aria-labelledby="home-deadlines">
      <div className="card-head">
        <h2 className="card-title display" id="home-deadlines">
          <Icon name="calendar" />
          Ближайшие сроки
        </h2>
        <Link className="card-link" href="/tasks">
          Дела <Icon name="arrow" size={16} />
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Ничего не запланировано.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {upcoming.map((t) => (
            <div key={t.id} className="task-row" style={{ minHeight: 44, gap: 12 }}>
              <span className="mono" style={{ width: 60, flex: 'none', fontSize: 13, color: 'var(--muted)' }}>
                {shortDate(t.due_date!, today)}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{t.title}</span>
              {t.tag && <span className="tag">{t.tag}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const listsCard = (
    <section className="card" aria-labelledby="home-lists">
      <div className="card-head">
        <h2 className="card-title display" id="home-lists">
          <Icon name="list" />
          Чек-листы
        </h2>
        <Link className="card-link" href="/lists">
          Все <Icon name="arrow" size={16} />
        </Link>
      </div>
      {data.checklists.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Чек-листов пока нет.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.checklists.map((c) => {
            const items = data.items.filter((i) => i.checklist_id === c.id);
            const got = items.filter((i) => i.done).length;
            return (
              <button key={c.id} type="button" className="list-card" onClick={() => openList(c.id)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                  <span className="list-icon">
                    <Icon name={c.icon} size={22} />
                  </span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{c.title}</span>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {got} из {items.length}
                  </span>
                </span>
                <span className="bar" style={{ width: '100%' }} aria-hidden="true">
                  <i style={{ width: items.length ? `${(got / items.length) * 100}%` : 0 }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ color: 'var(--muted)', fontWeight: 600 }}>{dayTitle(now)}</div>
          <h1 className="h1 display">{greeting}</h1>
        </div>
      </div>
      <AddTask />
      <div className="home-cols">
        <div className="home-col">
          {urgentCard}
          {todayCard}
        </div>
        <div className="home-col">
          {deadlinesCard}
          {listsCard}
        </div>
        <div className="home-col">
          <WeatherCard />
        </div>
      </div>
    </>
  );
}
