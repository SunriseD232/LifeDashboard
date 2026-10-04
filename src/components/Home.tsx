'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { dayTitle, localDay } from '@/lib/dates';
import { occurrenceKey, occurrencesOn } from '@/lib/occurrences';
import { shortDate } from '@/lib/tasks';
import type { Reminder } from '@/lib/types';
import { duration, plannedFor, setLabel } from '@/lib/workouts';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { RecipeCard, useKitchen } from './Kitchen';
import { noteTitle } from './Notes';
import { AddTask, TaskRow } from './Tasks';
import { QuickAdd } from './Ai';
import { WeatherCard, WeatherLine } from './Weather';
import { useIsPhone } from './Phone';
import Swipe from './Swipe';
import { dayHead, WeekStrip } from './Calendar';
import { agendaFor } from '@/lib/agenda';
import { timeline } from '@/lib/timeline';
import { AiButton } from './Ai';
import { useGym } from './Workouts';

/**
 * Главная: всё на сегодня одним взглядом — срочные дела, напоминания,
 * ближайшие сроки, погода, чек-листы. Карточки кухни, тренировок и заметок
 * появятся вместе с разделами.
 */
const asShort = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export default function Home() {
  const { data, mutate, now, setOpenList, toast } = useApp();
  const router = useRouter();
  const phone = useIsPhone();
  // Сводка — на выбранный в календаре день; сменили день — показываем свою.
  const [summary, setSummary] = useState<{ day: string; text: string } | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  // Старые ссылки (в том числе из уже присланных push): /task#reminders.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#reminders') router.replace('/tasks');
    else if (hash === '#lists') router.replace('/lists');
  }, [router]);

  const hour = now.getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const today = localDay(now);
  const todays = occurrencesOn(data.reminders, today, new Set(data.done), data.snoozed);
  const upcoming = data.tasks
    .filter((t) => !t.done_at && t.due_date !== null && t.due_date > today)
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

  const { k, byId, matchOf } = useKitchen();
  const cookable = k.recipes
    .map((r) => ({ r, m: matchOf(r) }))
    .filter((x) => x.m.missing.length <= 1)
    .sort((a, b) => a.m.missing.length - b.m.missing.length)
    .slice(0, 2);
  const toBuy = data.items.filter((i) => i.checklist_id === k.shopping_id && !i.done);
  const kitchenCard = (
    <section className="card" aria-labelledby="home-kitchen">
      <div className="card-head">
        <h2 className="card-title display" id="home-kitchen">
          <Icon name="pot" />
          Что приготовить
        </h2>
        <Link className="card-link" href="/kitchen">
          Кухня <Icon name="arrow" size={16} />
        </Link>
      </div>
      {k.recipes.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Рецептов пока нет — <Link href="/kitchen">добавьте базовые</Link>.
        </p>
      ) : cookable.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Из того, что дома, пока ничего не выходит. <Link href="/kitchen">Отметьте продукты</Link>.
        </p>
      ) : (
        cookable.map(({ r, m }) => <RecipeCard key={r.id} r={r} m={m} byId={byId} />)
      )}
      {toBuy.length > 0 && (
        <Link className="card-link" href="/kitchen?tab=shopping" style={{ marginLeft: 0 }}>
          <Icon name="cart" size={16} /> Купить: {toBuy.length}
        </Link>
      )}
    </section>
  );
  const { gym, names, records, active, start, today: gymDay } = useGym();
  const planned = plannedFor(gym.templates, gymDay);
  const lastDone = gym.workouts.find((w) => w.finished_at);
  // Последний рекорд — самый свежий подход-рекорд в журнале.
  const lastRecord = (() => {
    for (const w of gym.workouts) for (const e of w.exercises) for (const s of [...e.sets].reverse()) if (records.has(s.id)) return { name: names.get(e.exercise_id), s };
    return null;
  })();
  const gymCard = (gym.workouts.length > 0 || gym.templates.length > 0) && (
    <section className="card" aria-labelledby="home-gym">
      <div className="card-head">
        <h2 className="card-title display" id="home-gym">
          <Icon name="dumbbell" />
          Тренировка
        </h2>
        <Link className="card-link" href="/workouts">
          Журнал <Icon name="arrow" size={16} />
        </Link>
      </div>
      {active ? (
        <Link className="btn btn-primary" href={`/workouts?open=${active.id}`}>
          Идёт: {active.title} · {duration(active.started_at, null, now)}
        </Link>
      ) : (
        <>
          {planned && <div style={{ fontWeight: 600 }}>Сегодня по плану — {planned.title.toLowerCase()}</div>}
          {lastDone && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Прошлая: {lastDone.title.toLowerCase()} · {duration(lastDone.started_at, lastDone.finished_at)}
            </div>
          )}
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => {
              const id = await start(planned?.id);
              if (id) router.push(`/workouts?open=${id}`);
            }}
          >
            <Icon name="plus" size={18} />
            {planned ? `Начать: ${planned.title}` : 'Начать тренировку'}
          </button>
        </>
      )}
      {lastRecord && (
        <span className="chip chip-warm" style={{ alignSelf: 'flex-start' }}>
          <Icon name="trophy" size={14} />
          {lastRecord.name}: {setLabel(lastRecord.s)}
        </span>
      )}
    </section>
  );
  const pinned = data.notes.filter((n) => n.pinned).slice(0, 3);
  const pinnedCard = pinned.length > 0 && (
    <section className="card" aria-labelledby="home-pinned" style={{ background: 'var(--warm-bg)', borderColor: 'var(--warm-line)' }}>
      <div className="card-head">
        <h2 className="card-title display" id="home-pinned">
          <Icon name="pin" />
          Закреплено
        </h2>
        <Link className="card-link" href="/notes">
          Заметки <Icon name="arrow" size={16} />
        </Link>
      </div>
      {pinned.map((n) => (
        <Link key={n.id} href={`/notes?open=${n.id}`} className="pinned-note">
          <span style={{ fontWeight: 600 }}>{noteTitle(n)}</span>
          <span className="pinned-body">{n.title.trim() ? n.body : n.body.split('\n').slice(1).join('\n')}</span>
        </Link>
      ))}
    </section>
  );

  // ---------------------------------------------------------------- календарь
  // Лента недели (на компьютере — месяц); под ней — дела выбранного дня.
  // Сегодня — с галочками (просроченное, напоминания по времени, дела);
  // другой день — что на него запланировано. Сводка — на выбранный день.
const day = pickedDay ?? today;
const doneSet = new Set(data.done);
const dots = (d: string) => agendaFor(d, data.tasks, data.reminders, today, doneSet);
const groups = timeline(data.tasks, data.reminders, today, doneSet, data.snoozed);
const todayRows = groups.filter((g) => g.id === 'overdue' || g.id === 'today').flatMap((g) => g.rows);
const undated = groups.find((g) => g.id === 'none')?.rows.length ?? 0;
const remRow = (o: (typeof todays)[number]) => (
  <Swipe key={o.key} onRight={o.done ? undefined : () => toggle(o.reminder, o.slot, true)}>
  <label className={`check round${o.done ? ' done' : ''}`}>
    <input type="checkbox" checked={o.done} onChange={(e) => toggle(o.reminder, o.slot, e.target.checked)} />
    <span className="check-text" style={{ flex: 1 }}>{o.reminder.title}</span>
    <span className="mono" style={{ fontSize: 13, color: 'var(--muted)', flex: 'none' }}>
      {o.snoozedTo ?? o.slot}
    </span>
  </label>
  </Swipe>
);
const otherDay = day === today ? [] : dots(day);

  const makeSummary = async () => {
    setSummaryBusy(true);
    try {
      const r = await api<{ text: string }>('ai/summary', 'POST', { today, day });
      setSummary({ day, text: r.text });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSummaryBusy(false);
    }
  };
  const summaryFor = summary?.day === day ? summary.text : null;
  const dayList = (
    <section aria-labelledby="home-day" className="phone-list">
      <h2 className="group-title" id="home-day">
        {dayHead(day, today)}
      </h2>
      {day === today ? (
        todayRows.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>На сегодня ничего — можно выдохнуть.</p>
        ) : (
          todayRows.map((r) => (r.kind === 'rem' ? remRow(r.occ) : <TaskRow key={r.key} task={r.task} hideDue={r.task.due_date === today} />))
        )
      ) : otherDay.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Ничего не запланировано.</p>
      ) : (
        otherDay.map((i) => (
          <Link key={i.key} href={i.kind === 'task' ? `/tasks?open=${i.id}` : `/tasks?edit=${i.id}`} className="cal-item">
            <Icon name={i.kind === 'task' ? 'tasks' : 'bell'} size={16} />
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{i.title}</span>
            <span className="mono cal-time" style={{ textAlign: 'right' }}>
              {i.time ?? ''}
            </span>
          </Link>
        ))
      )}
      {day === today && undated > 0 && (
        <Link className="card-link" href="/tasks" style={{ marginLeft: 0, padding: '10px 0' }}>
          Без срока: {undated} <Icon name="arrow" size={16} />
        </Link>
      )}
    </section>
  );
  const summaryBlock =
    data.ai &&
    (summaryFor ? (
      <div className="phone-summary">
        <p style={{ margin: 0, lineHeight: 1.55 }}>{summaryFor}</p>
      </div>
    ) : (
      <AiButton busy={summaryBusy} onClick={makeSummary} style={{ marginTop: 16, alignSelf: 'flex-start' }}>
        {day === today ? 'Сводка дня' : `Сводка на ${asShort(day)}`}
      </AiButton>
    ));
  const pick = (d: string) => setPickedDay(d === today ? null : d);

  if (phone) {
    // ---------------------------------------------------------------- телефон
    // Лента недели сверху; под ней — дела выбранного дня. Сегодня — с
    // галочками (просроченное, напоминания по времени, дела); другой день —
    // что на него запланировано. Остальное — плитками, если есть что показать.
    const inProgress = data.checklists
      .filter((c) => c.kind !== 'shopping')
      .map((c) => {
        const items = data.items.filter((i) => i.checklist_id === c.id);
        return { c, got: items.filter((i) => i.done).length, total: items.length };
      })
      .find((x) => x.got > 0 && x.got < x.total);
    const next = upcoming[0];

    return (
      <>
        <div className="phone-hello">
          <h1 className="h1 display">{greeting}</h1>
          <WeatherLine />
        </div>
        {data.ai ? <QuickAdd plain /> : <AddTask />}

        <WeekStrip key="week" sel={day} today={today} onPick={pick} dots={dots} />

        {dayList}

        <div className="tiles">
          {next && (
            <Link className="tile" href="/tasks">
              <Icon name="calendar" size={18} />
              <span className="tile-label">Скоро</span>
              <span className="tile-value">
                {shortDate(next.due_date!, today)} · {next.title}
              </span>
            </Link>
          )}
          {toBuy.length > 0 && (
            <Link className="tile" href="/kitchen?tab=shopping">
              <Icon name="cart" size={18} />
              <span className="tile-label">Купить</span>
              <span className="tile-value">{toBuy.length}</span>
            </Link>
          )}
          {(active || planned) && (
            <Link className="tile" href={active ? `/workouts?open=${active.id}` : '/workouts'}>
              <Icon name="dumbbell" size={18} />
              <span className="tile-label">{active ? 'Идёт тренировка' : 'Тренировка'}</span>
              <span className="tile-value">{active ? duration(active.started_at, null, now) : planned!.title}</span>
            </Link>
          )}
          {inProgress && (
            <button className="tile" type="button" onClick={() => openList(inProgress.c.id)}>
              <Icon name="list" size={18} />
              <span className="tile-label">{inProgress.c.title}</span>
              <span className="tile-value">
                {inProgress.got} из {inProgress.total}
              </span>
            </button>
          )}
          {pinned.length > 0 && (
            <Link className="tile" href={pinned.length === 1 ? `/notes?open=${pinned[0].id}` : '/notes'}>
              <Icon name="pin" size={18} />
              <span className="tile-label">{pinned.length === 1 ? 'Закреплено' : `Закреплено · ${pinned.length}`}</span>
              <span className="tile-value">{noteTitle(pinned[0])}</span>
            </Link>
          )}
        </div>

        {summaryBlock}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ color: 'var(--muted)', fontWeight: 600 }}>{dayTitle(now)}</div>
          <h1 className="h1 display">{greeting}</h1>
        </div>
      </div>
      {data.ai ? <QuickAdd plain /> : <AddTask />}
      <div className="home-cols">
        <div className="home-col">
          <section className="card home-cal" aria-label="Календарь">
            <WeekStrip key="month" sel={day} today={today} onPick={pick} dots={dots} alwaysMonth />
            {dayList}
            {summaryBlock}
          </section>
        </div>
        <div className="home-col">
          {deadlinesCard}
          {gymCard}
          {listsCard}
          {pinnedCard}
        </div>
        <div className="home-col">
          <WeatherCard />
          {kitchenCard}
        </div>
      </div>
    </>
  );
}
