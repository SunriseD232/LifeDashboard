'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { agendaFor } from '@/lib/agenda';
import { api } from '@/lib/api';
import { handOffReceipt } from '@/lib/audio';
import { money } from '@/lib/currencies';
import { localDay, plural } from '@/lib/dates';
import { arrangeTiles, parseHub, parseUsage, pickShortcuts, type ShortcutDef } from '@/lib/hub';
import { convert, type MoneyState } from '@/lib/money';
import { shortDate } from '@/lib/tasks';
import { timeline, leftToday, type Row } from '@/lib/timeline';
import { temp } from '@/lib/weather';
import { plannedFor } from '@/lib/workouts';
import { AiButton } from './Ai';
import { useApp } from './AppShell';
import Composer, { type ComposerStart } from './Composer';
import { Icon } from './icons';
import { useKitchen } from './Kitchen';
import { dayHead, WeekStrip } from './MiniCalendar';
import { noteTitle } from './Notes';
import { useReminderActions } from './reminderActions';
import { useTaskActions } from './Tasks';
import { useWeather } from './Weather';

/**
 * Главная супер-аппа — и «Сегодня» «Дашборда»: плитки с самым важным из дел
 * и «Денег» и быстрые действия. Какие плитки, в каком порядке и какого
 * размера — Настройки → «Главная»; действия подбираются по тому, что человек
 * чаще нажимает в эту часть дня. Нажатие на плитку — в раздел; дела можно
 * отметить прямо тут.
 */

function greeting(h: number): string {
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** Данные «Денег» для плиток: раздел закрыт или не настроен — null. */
function useMoneyState(): MoneyState | null {
  const [s, setS] = useState<MoneyState | null>(null);
  useEffect(() => {
    let alive = true;
    api<MoneyState>(`money/state?month=${localDay().slice(0, 7)}`)
      .then((r) => alive && setS(r.settings ? r : null))
      .catch(() => alive && setS(null));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

export default function Hub() {
  const { data, now } = useApp();
  const router = useRouter();
  const m = useMoneyState();
  const { city, w } = useWeather();
  const photo = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState('');
  const [composer, setComposer] = useState<ComposerStart | null>(null);
  const today = localDay(now);
  const dayText = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const prefs = parseHub(data.settings.hub);
  // Порядок действий считаем при открытии: нажали — сменится в следующий раз, а не под пальцем.
  const [hour] = useState(() => now.getHours());

  // Старые ссылки (в том числе из уже присланных push): /task#reminders.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#reminders') router.replace('/tasks');
    else if (hash === '#lists') router.replace('/lists');
  }, [router]);

  const GO: Record<string, () => void> = {
    op: () => router.push('/money?new=op'),
    receipt: () => photo.current?.click(),
    task: () => router.push('/tasks?new=1'),
    buy: () => router.push('/kitchen?tab=shopping'),
    gym: () => router.push('/workouts'),
    note: () => router.push('/notes'),
    list: () => router.push('/lists'),
    cook: () => router.push('/kitchen'),
    report: () => router.push('/money/report'),
    ops: () => router.push('/money/ops'),
  };
  const shortcuts = pickShortcuts(prefs, parseUsage(data.settings.hub_usage), hour, !!m);
  const press = (s: ShortcutDef) => {
    api('hub/use', 'POST', { id: s.id, hour: new Date().getHours() }).catch(() => undefined);
    GO[s.id]();
  };

  const tiles = arrangeTiles(prefs, !!m).filter((t) => !t.hidden);
  const tile = (id: string, wide: boolean): ReactNode => {
    switch (id) {
      case 'today':
        return <TodayTile wide={wide} />;
      case 'soon':
        return <SoonTile wide={wide} />;
      case 'shopping':
        return <ShoppingTile wide={wide} />;
      case 'gym':
        return <GymTile wide={wide} today={today} />;
      case 'pinned':
        return <PinnedTile wide={wide} />;
      case 'lists':
        return <ListsTile wide={wide} />;
      case 'cook':
        return <CookTile wide={wide} />;
    }
    if (!m) return null;
    switch (id) {
      case 'spend':
        return <SpendTile wide={wide} m={m} />;
      case 'balance':
        return <BalanceTile wide={wide} m={m} />;
      case 'budget':
        return <BudgetTile wide={wide} m={m} />;
      case 'recurring':
        return <RecurringTile wide={wide} m={m} />;
      case 'goal':
        return <GoalTile wide={wide} m={m} />;
      case 'debts':
        return <DebtsTile wide={wide} m={m} />;
      case 'rates':
        return <RatesTile wide={wide} m={m} />;
    }
    return null;
  };

  return (
    <div className="hub">
      <input
        ref={photo}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          handOffReceipt(f);
          router.push('/money');
        }}
      />
      <header className="hub-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hub-date">{dayText.charAt(0).toUpperCase() + dayText.slice(1)}</div>
          <h1 className="h1 display" style={{ margin: 0 }}>
            {greeting(now.getHours())}
          </h1>
        </div>
        {city && w && (
          <span className="hub-weather" title={w.now.label}>
            <Icon name={w.now.icon} size={22} />
            <b className="display">{temp(w.now.temp)}</b>
          </span>
        )}
        <Link className="icon-btn bare" href="/settings?tab=home" aria-label="Настроить главную" title="Настроить главную">
          <Icon name="edit" />
        </Link>
      </header>

      {/* На компьютере нижнего меню нет — «Записать» прямо на главной. */}
      <form
        className="hub-ask"
        onSubmit={(e) => {
          e.preventDefault();
          const t = ask.trim();
          if (t) setComposer({ text: t });
        }}
      >
        <label htmlFor="hub-ask" className="sr-only">
          Записать или спросить
        </label>
        <input id="hub-ask" className="field" placeholder="Записать или спросить… Кофе 350, завтра в 9 позвонить врачу" value={ask} onChange={(e) => setAsk(e.target.value)} />
        <button className="btn btn-ghost" type="button" aria-label="Надиктовать" onClick={() => setComposer({ voice: true })}>
          <Icon name="mic" size={20} />
        </button>
        <button className="btn btn-primary" type="submit" disabled={!ask.trim()}>
          Разобрать
        </button>
      </form>
      {composer && (
        <Composer
          start={composer}
          onClose={(saved) => {
            setComposer(null);
            if (saved) setAsk('');
          }}
          onOpenMoney={() => router.push('/money')}
        />
      )}

      <nav className="hub-quick" aria-label="Быстрые действия">
        {shortcuts.map((s, i) => (
          <button key={s.id} type="button" className={`hub-sc${i === 0 ? ' main' : ''}`} onClick={() => press(s)}>
            <span className="hub-sc-i">
              <Icon name={s.icon} size={24} />
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="hub-grid">
        {tiles.map((t) => (
          <Fragment key={t.id}>{tile(t.id, t.size === 'w')}</Fragment>
        ))}
      </div>
    </div>
  );
}

const cls = (wide: boolean, extra = '') => `hub-tile${wide ? ' wide' : ''}${extra}`;

function Lbl({ icon, tone, children }: { icon: string; tone?: 'blue' | 'warm'; children: ReactNode }) {
  return (
    <>
      <span className={`hub-ico${tone ? ` ${tone}` : ''}`}>
        <Icon name={icon} size={16} />
      </span>
      {children}
    </>
  );
}

function TodayTile({ wide }: { wide: boolean }) {
  const { data, now, toast } = useApp();
  const today = localDay(now);
  const [picked, setPicked] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ day: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const day = picked ?? today;
  const doneSet = new Set(data.done);
  const dots = (d: string) => agendaFor(d, data.reminders, today, doneSet);
  const groups = timeline(data.tasks, data.reminders, today, doneSet, data.snoozed);
  const left = leftToday(groups);
  const rows: Row[] = [...(groups.find((g) => g.id === 'overdue')?.rows ?? []), ...(groups.find((g) => g.id === 'today')?.rows ?? [])].filter((r) => (r.kind === 'rem' ? !r.occ.done : !r.task.done_at));
  // Дел на день мало — добавим важные задачи без срока.
  const extra = (groups.find((g) => g.id === 'none')?.rows ?? []).filter((r) => r.kind === 'task' && !r.task.done_at).sort((a, b) => (b.kind === 'task' ? b.task.priority : 0) - (a.kind === 'task' ? a.task.priority : 0));
  const shown = [...rows, ...extra].slice(0, wide ? 4 : 3);
  const more = rows.length + extra.length - shown.length;
  const doneToday = data.done.length + data.tasksDoneToday.length;
  const tasks = useTaskActions();
  const rem = useReminderActions();
  const other = day === today ? [] : dots(day);
  const text = summary?.day === day ? summary.text : null;

  const makeSummary = async () => {
    setBusy(true);
    try {
      const r = await api<{ text: string }>('ai/summary', 'POST', { today, day });
      setSummary({ day, text: r.text });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cls(wide, ' today')} aria-label="Сегодня">
      <Link className="hub-lbl" href="/tasks">
        <Lbl icon="tasks" tone="blue">
          {day === today ? 'Сегодня' : dayHead(day, today)}
        </Lbl>
        <span style={{ marginLeft: 'auto' }}>{day !== today ? '' : left ? `осталось ${left}` : doneToday ? 'всё сделано' : ''}</span>
      </Link>
      <div className="hub-week">
        <WeekStrip key="week" sel={day} today={today} onPick={(d) => setPicked(d === today ? null : d)} dots={dots} />
      </div>
      {day === today ? (
        <>
          {!shown.length && <p className="hub-sub" style={{ margin: '6px 0 0' }}>На сегодня дел нет. Нажмите «+» внизу, чтобы записать.</p>}
          {shown.map((r) => {
            const title = r.kind === 'task' ? r.task.title : r.occ.reminder.title;
            const note = r.kind === 'task' ? r.task.note : r.occ.reminder.note;
            const listId = r.kind === 'task' ? r.task.checklist_id : r.occ.reminder.checklist_id;
            const sub = listId ? data.items.filter((i) => i.checklist_id === listId) : [];
            const meta = [sub.length ? `подзадачи ${sub.filter((i) => i.done).length} из ${sub.length}` : null, note ? note.split('\n')[0] : null].filter(Boolean).join(' · ');
            const id = r.kind === 'task' ? r.task.id : r.occ.reminder.id;
            return (
              <div key={r.key} className="hub-task">
                <button
                  type="button"
                  className="hub-box"
                  aria-label={`Сделано: ${title}`}
                  onClick={() => (r.kind === 'task' ? tasks.complete(r.task) : rem.done(r.occ.reminder, r.occ.slot, true))}
                />
                <Link className="hub-tt" href={`/tasks?open=${id}`}>
                  <b>{title}</b>
                  {meta && <small>{meta}</small>}
                </Link>
                {r.kind === 'rem' && <span className="hub-when">{r.date < today ? 'просрочено' : r.time}</span>}
              </div>
            );
          })}
          {more > 0 && (
            <Link className="hub-more" href="/tasks">
              Ещё {plural(more, 'дело', 'дела', 'дел')}
            </Link>
          )}
        </>
      ) : other.length === 0 ? (
        <p className="hub-sub" style={{ margin: '6px 0 0' }}>Ничего не запланировано.</p>
      ) : (
        other.slice(0, 5).map((i) => (
          <Link key={i.key} href={`/tasks?edit=${i.id}`} className="hub-task hub-tt" style={{ textDecoration: 'none' }}>
            <b style={{ flex: 1 }}>{i.title}</b>
            {i.time && <span className="hub-when">{i.time}</span>}
          </Link>
        ))
      )}
      {data.ai &&
        (text ? (
          <p className="hub-summary">{text}</p>
        ) : (
          <AiButton busy={busy} onClick={makeSummary} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
            {day === today ? 'Сводка дня' : 'Сводка на этот день'}
          </AiButton>
        ))}
    </section>
  );
}

/** Ближайшие разовые напоминания со сроком — после сегодняшнего дня. */
function SoonTile({ wide }: { wide: boolean }) {
  const { data, now } = useApp();
  const today = localDay(now);
  const soon = data.reminders
    .filter((r) => r.rule.kind === 'once' && r.rule.date > today && !r.last_done)
    .map((r) => ({ r, date: (r.rule as { date: string }).date }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.r.times[0].localeCompare(b.r.times[0]))
    .slice(0, wide ? 4 : 2);
  if (!soon.length) return null;
  return (
    <Link className={cls(wide)} href="/tasks">
      <span className="hub-lbl">
        <Lbl icon="calendar" tone="blue">
          Сроки
        </Lbl>
      </span>
      {soon.map(({ r, date }) => (
        <span key={r.id} className="hub-li">
          <b>{r.title}</b>
          <small>
            {shortDate(date, today)}
            {date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''} · {r.times[0]}
          </small>
        </span>
      ))}
    </Link>
  );
}

function ShoppingTile({ wide }: { wide: boolean }) {
  const { data } = useApp();
  const items = data.items.filter((i) => i.checklist_id === data.kitchen.shopping_id && !i.done);
  const n = wide ? 6 : 3;
  return (
    <Link className={cls(wide)} href="/kitchen?tab=shopping">
      <span className="hub-lbl">
        <Lbl icon="cart" tone="blue">
          Купить
        </Lbl>
      </span>
      <span className="hub-big">{items.length || '—'}</span>
      <span className="hub-sub">{items.length ? items.slice(0, n).map((i) => i.title).join(', ') + (items.length > n ? ` и ещё ${items.length - n}` : '') : 'список пуст'}</span>
    </Link>
  );
}

function GymTile({ wide, today }: { wide: boolean; today: string }) {
  const { data } = useApp();
  const ws = data.gym.workouts;
  const todays = ws.find((w) => w.day === today);
  const planned = plannedFor(data.gym.templates, today);
  const weekAgo = new Date(Date.parse(`${today}T12:00:00`) - 6 * 864e5).toISOString().slice(0, 10);
  const week = ws.filter((w) => w.day >= weekAgo).length;
  const last = [...ws].sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  const big = todays ? todays.title : planned ? planned.title : week ? plural(week, 'раз', 'раза', 'раз') : '—';
  const sub = todays
    ? todays.finished_at
      ? 'сегодня, завершена'
      : 'сегодня, идёт'
    : planned
      ? 'по плану на сегодня'
      : week
        ? 'за неделю'
        : last
          ? `последняя ${new Date(`${last.day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
          : 'ещё не было';
  return (
    <Link className={cls(wide)} href={todays && !todays.finished_at ? `/workouts?open=${todays.id}` : '/workouts'}>
      <span className="hub-lbl">
        <Lbl icon="dumbbell" tone="blue">
          Тренировки
        </Lbl>
      </span>
      <span className="hub-big small">{big}</span>
      <span className="hub-sub">{sub}</span>
    </Link>
  );
}

function PinnedTile({ wide }: { wide: boolean }) {
  const { data } = useApp();
  const pinned = data.notes.filter((n) => n.pinned);
  if (!pinned.length) return null;
  return (
    <Link className={cls(wide, ' warm')} href={pinned.length === 1 ? `/notes?open=${pinned[0].id}` : '/notes'}>
      <span className="hub-lbl">
        <Lbl icon="pin" tone="warm">
          {pinned.length === 1 ? 'Закреплено' : `Закреплено · ${pinned.length}`}
        </Lbl>
      </span>
      {pinned.slice(0, wide ? 3 : 2).map((n) => (
        <span key={n.id} className="hub-li">
          <b>{noteTitle(n)}</b>
          <small>{(n.title.trim() ? n.body : n.body.split('\n').slice(1).join(' ')).replace(/\s+/g, ' ').slice(0, 120)}</small>
        </span>
      ))}
    </Link>
  );
}

/** Начатые чек-листы (кроме покупок). */
function ListsTile({ wide }: { wide: boolean }) {
  const { data, setOpenList } = useApp();
  const router = useRouter();
  const lists = data.checklists
    .filter((c) => c.kind !== 'shopping')
    .map((c) => {
      const items = data.items.filter((i) => i.checklist_id === c.id);
      return { c, got: items.filter((i) => i.done).length, total: items.length };
    })
    .filter((x) => x.total > 0 && x.got < x.total)
    .sort((a, b) => b.got / b.total - a.got / a.total)
    .slice(0, wide ? 3 : 2);
  if (!lists.length) return null;
  return (
    <section className={cls(wide)} aria-label="Чек-листы">
      <Link className="hub-lbl" href="/lists">
        <Lbl icon="list" tone="blue">
          Чек-листы
        </Lbl>
      </Link>
      {lists.map(({ c, got, total }) => (
        <button
          key={c.id}
          type="button"
          className="hub-li hub-li-btn"
          onClick={() => {
            setOpenList(c.id);
            router.push('/lists');
          }}
        >
          <b>{c.title}</b>
          <small>
            {got} из {total}
          </small>
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${(got / total) * 100}%` }} />
          </span>
        </button>
      ))}
    </section>
  );
}

/** Рецепты, для которых всё (или почти всё) есть дома. */
function CookTile({ wide }: { wide: boolean }) {
  const { k, matchOf } = useKitchen();
  const ok = k.recipes
    .map((r) => ({ r, m: matchOf(r) }))
    .filter((x) => x.m.missing.length <= 1)
    .sort((a, b) => a.m.missing.length - b.m.missing.length)
    .slice(0, wide ? 3 : 2);
  return (
    <Link className={cls(wide)} href="/kitchen">
      <span className="hub-lbl">
        <Lbl icon="pot" tone="blue">
          Что приготовить
        </Lbl>
      </span>
      {ok.length ? (
        ok.map(({ r, m }) => (
          <span key={r.id} className="hub-li">
            <b>{r.title}</b>
            <small>{m.missing.length ? 'не хватает одного' : 'всё есть'}</small>
          </span>
        ))
      ) : (
        <span className="hub-sub">{k.recipes.length ? 'из того, что дома, пока ничего' : 'рецептов пока нет'}</span>
      )}
    </Link>
  );
}

const rateOf = (m: MoneyState) => (c: string) => (c === 'RUB' ? 1 : (m.rates[c] ?? m.user_rates[c]));

function SpendTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const base = m.settings!.base_currency;
  const spend = m.month_parts.reduce((s, p) => s + p.base_minor, 0);
  const prev = m.prev_spend.mine + m.prev_spend.family;
  const delta = prev > 0 ? Math.round(((spend - prev) / prev) * 100) : null;
  // На компьютере места больше — три главные категории.
  const byCat = new Map<string | null, number>();
  for (const p of m.month_parts) byCat.set(p.category_id, (byCat.get(p.category_id) ?? 0) + p.base_minor);
  const top = [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <Link className={cls(wide)} href="/money/report">
      <span className="hub-lbl">
        <Lbl icon="chart">Траты месяца</Lbl>
      </span>
      <span className="hub-big">{money(spend, base, { whole: true })}</span>
      <span className="hub-sub">{delta === null ? 'за этот месяц' : delta === 0 ? 'как в прошлом месяце' : `на ${Math.abs(delta)}% ${delta < 0 ? 'меньше' : 'больше'}, чем в прошлом`}</span>
      {top.length > 0 && (
        <span className="hub-desk">
          {top.map(([id, sum]) => (
            <span key={id ?? '-'} className="hub-cat">
              <span>
                <b>{m.categories.find((c) => c.id === id)?.name ?? 'Без категории'}</b>
                <small className="mono">{money(sum, base, { whole: true })}</small>
              </span>
              <span className="bar">
                <i style={{ width: `${Math.max(2, Math.round((sum / top[0][1]) * 100))}%` }} />
              </span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

function BalanceTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const base = m.settings!.base_currency;
  const toBase = (minor: number, c: string) => convert(minor, c, base, rateOf(m)) ?? 0;
  const live = m.accounts.filter((a) => !a.archived);
  const total = live.reduce((s, a) => s + toBase(a.balance_minor, a.currency), 0);
  const foreign = live.filter((a) => a.currency !== base && a.balance_minor > 0);
  return (
    <Link className={cls(wide)} href="/money/accounts">
      <span className="hub-lbl">
        <Lbl icon="wallet">На счетах</Lbl>
      </span>
      <span className="hub-big">{money(total, base, { whole: true })}</span>
      {foreign.length > 0 && <span className="hub-sub hub-phone">в т.ч. {foreign.slice(0, 2).map((a) => money(a.balance_minor, a.currency, { whole: true })).join(' и ')}</span>}
      {/* На компьютере — счета списком. */}
      <span className="hub-desk">
        {live.slice(0, 4).map((a) => (
          <span key={a.id} className="hub-cat">
            <span>
              <b>{a.name}</b>
              <small className="mono">{money(a.balance_minor, a.currency, { whole: true })}</small>
            </span>
          </span>
        ))}
      </span>
    </Link>
  );
}

/** Бюджет, который ближе всех к пределу (с половины лимита). */
function BudgetTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const base = m.settings!.base_currency;
  const spentBy = new Map<string | null, number>();
  for (const p of m.month_parts) spentBy.set(p.category_id, (spentBy.get(p.category_id) ?? 0) + p.base_minor);
  const budget = m.budgets
    .map((b) => ({ ...b, spent: spentBy.get(b.category_id) ?? 0, name: m.categories.find((c) => c.id === b.category_id)?.name ?? '' }))
    .filter((b) => b.spent / b.limit_minor >= 0.5)
    .sort((a, b) => b.spent / b.limit_minor - a.spent / a.limit_minor)[0];
  if (!budget) return null;
  const hot = budget.spent >= budget.limit_minor * 0.9;
  const over = budget.spent >= budget.limit_minor;
  return (
    <Link className={cls(wide)} href="/money/report#budgets">
      <span className="hub-lbl">
        <Lbl icon="flag" tone={hot ? 'warm' : undefined}>
          {budget.name}
        </Lbl>
      </span>
      <span className="hub-big small">{over ? `+${money(budget.spent - budget.limit_minor, base, { whole: true })}` : money(budget.limit_minor - budget.spent, base, { whole: true })}</span>
      <span className="hub-sub">{over ? 'сверх бюджета' : 'осталось до конца месяца'}</span>
      <span className={`bar${hot ? ' warm' : ''}`} style={{ marginTop: 'auto' }}>
        <i style={{ width: `${Math.min(100, Math.round((budget.spent / budget.limit_minor) * 100))}%` }} />
      </span>
    </Link>
  );
}

function RecurringTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const upcoming = m.recurring.filter((r) => r.active && r.next_day <= soon).slice(0, wide ? 4 : 2);
  if (!upcoming.length) return null;
  return (
    <Link className={cls(wide)} href="/money/recurring">
      <span className="hub-lbl">
        <Lbl icon="repeat">Платежи скоро</Lbl>
      </span>
      {upcoming.map((r) => (
        <span key={r.id} className="hub-li">
          <b>{r.payee}</b>
          <small>
            {new Date(`${r.next_day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · {money(r.amount_minor, r.currency, { whole: true })}
          </small>
        </span>
      ))}
    </Link>
  );
}

function GoalTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const g = m.goals[0];
  if (!g) return null;
  const acc = g.account_id ? m.accounts.find((a) => a.id === g.account_id) : null;
  const have = acc ? (convert(Math.max(0, acc.balance_minor), acc.currency, g.currency, rateOf(m)) ?? 0) : g.saved_minor;
  const share = g.target_minor ? Math.min(1, have / g.target_minor) : 0;
  return (
    <Link className={cls(wide)} href="/money/goals" style={{ minHeight: 0 }}>
      <span className="hub-lbl">
        <Lbl icon="flag">Цель: {g.name}</Lbl>
        {wide && (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--ink)' }}>
            {money(have, g.currency, { whole: true })} / {money(g.target_minor, g.currency, { whole: true })}
          </span>
        )}
      </span>
      {!wide && <span className="hub-big small">{Math.round(share * 100)}%</span>}
      <span className="bar" style={{ marginTop: 8 }}>
        <i style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </span>
    </Link>
  );
}

function DebtsTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const open = m.debts.filter((d) => !d.closed && d.amount_minor > d.paid_minor);
  if (!open.length) return null;
  return (
    <Link className={cls(wide)} href="/money/debts">
      <span className="hub-lbl">
        <Lbl icon="users">Долги</Lbl>
      </span>
      {open.slice(0, wide ? 4 : 2).map((d) => (
        <span key={d.id} className="hub-li">
          <b>{d.person}</b>
          <small>
            {d.direction === 'lent' ? 'должен вам' : 'вы должны'} · {money(d.amount_minor - d.paid_minor, d.currency, { whole: true })}
          </small>
        </span>
      ))}
    </Link>
  );
}

function RatesTile({ wide, m }: { wide: boolean; m: MoneyState }) {
  const base = m.settings!.base_currency;
  const cur = m.settings!.currencies.filter((c) => c !== base && m.rates[c]).slice(0, wide ? 4 : 3);
  if (!cur.length || base !== 'RUB') return null;
  return (
    <Link className={cls(wide)} href="/money/settings">
      <span className="hub-lbl">
        <Lbl icon="exchange">Курсы ЦБ</Lbl>
      </span>
      {cur.map((c) => (
        <span key={c} className="hub-li">
          <b className="mono">
            {c} · {m.rates[c].toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽
          </b>
        </span>
      ))}
      {m.rates_day && <span className="hub-sub">на {new Date(`${m.rates_day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>}
    </Link>
  );
}
