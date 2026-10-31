'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { handOffReceipt } from '@/lib/audio';
import { money } from '@/lib/currencies';
import { localDay, plural } from '@/lib/dates';
import { convert, type MoneyState } from '@/lib/money';
import { timeline, leftToday, type Row } from '@/lib/timeline';
import { temp } from '@/lib/weather';
import { useApp } from './AppShell';
import Composer, { type ComposerStart } from './Composer';
import { Icon } from './icons';
import { useReminderActions } from './reminderActions';
import { useTaskActions } from './Tasks';
import { useWeather } from './Weather';

/**
 * Главная супер-аппа: плитки с самым важным из «Дашборда» и «Денег» и
 * быстрые действия. Нажатие на плитку — в раздел; дела можно отметить прямо тут.
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

  const shortcuts = [
    m && { key: 'op', label: 'Трата', icon: 'plus', main: true, go: () => router.push('/money?new=op') },
    m && { key: 'receipt', label: 'Чек', icon: 'receipt', go: () => photo.current?.click() },
    { key: 'task', label: 'Дело', icon: 'tasks', go: () => router.push('/tasks?new=1') },
    { key: 'buy', label: 'Покупка', icon: 'cart', go: () => router.push('/kitchen?tab=shopping') },
    { key: 'gym', label: 'Тренировка', icon: 'dumbbell', go: () => router.push('/workouts') },
  ].filter(Boolean) as { key: string; label: string; icon: string; main?: boolean; go: () => void }[];

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
        {shortcuts.map((s) => (
          <button key={s.key} type="button" className={`hub-sc${s.main ? ' main' : ''}`} onClick={s.go}>
            <span className="hub-sc-i">
              <Icon name={s.icon} size={24} />
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="hub-grid">
        <TodayTile />
        {m && <MoneyTiles m={m} />}
        <ShoppingTile />
        <GymTile today={today} />
        {m && <GoalTile m={m} />}
      </div>
    </div>
  );
}

function TodayTile() {
  const { data, now } = useApp();
  const today = localDay(now);
  const groups = timeline(data.tasks, data.reminders, today, new Set(data.done), data.snoozed);
  const left = leftToday(groups);
  const rows: Row[] = [...(groups.find((g) => g.id === 'overdue')?.rows ?? []), ...(groups.find((g) => g.id === 'today')?.rows ?? [])].filter((r) => (r.kind === 'rem' ? !r.occ.done : !r.task.done_at));
  // Дел на день мало — добавим важные задачи без срока.
  const extra = (groups.find((g) => g.id === 'none')?.rows ?? []).filter((r) => r.kind === 'task' && !r.task.done_at).sort((a, b) => (b.kind === 'task' ? b.task.priority : 0) - (a.kind === 'task' ? a.task.priority : 0));
  const shown = [...rows, ...extra].slice(0, 3);
  const more = rows.length + extra.length - shown.length;
  const doneToday = data.done.length + data.tasksDoneToday.length;
  const tasks = useTaskActions();
  const rem = useReminderActions();

  return (
    <section className="hub-tile wide" aria-label="Сегодня">
      <Link className="hub-lbl" href="/today">
        <span className="hub-ico blue">
          <Icon name="tasks" size={16} />
        </span>
        Сегодня
        <span style={{ marginLeft: 'auto' }}>{left ? `осталось ${left}` : doneToday ? 'всё сделано' : ''}</span>
      </Link>
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
        <Link className="hub-more" href="/today">
          Ещё {plural(more, 'дело', 'дела', 'дел')}
        </Link>
      )}
    </section>
  );
}

function MoneyTiles({ m }: { m: MoneyState }) {
  const base = m.settings!.base_currency;
  const rateOf = (c: string) => (c === 'RUB' ? 1 : (m.rates[c] ?? m.user_rates[c]));
  const toBase = (minor: number, c: string) => convert(minor, c, base, rateOf) ?? 0;
  const spend = m.month_parts.reduce((s, p) => s + p.base_minor, 0);
  const prev = m.prev_spend.mine + m.prev_spend.family;
  const delta = prev > 0 ? Math.round(((spend - prev) / prev) * 100) : null;
  const total = m.accounts.filter((a) => !a.archived).reduce((s, a) => s + toBase(a.balance_minor, a.currency), 0);
  const foreign = m.accounts.filter((a) => !a.archived && a.currency !== base && a.balance_minor > 0);
  const spentBy = new Map<string | null, number>();
  for (const p of m.month_parts) spentBy.set(p.category_id, (spentBy.get(p.category_id) ?? 0) + p.base_minor);
  // Бюджет, который ближе всех к пределу (с половины лимита).
  const budget = m.budgets
    .map((b) => ({ ...b, spent: spentBy.get(b.category_id) ?? 0, name: m.categories.find((c) => c.id === b.category_id)?.name ?? '' }))
    .filter((b) => b.spent / b.limit_minor >= 0.5)
    .sort((a, b) => b.spent / b.limit_minor - a.spent / a.limit_minor)[0];
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const upcoming = m.recurring.filter((r) => r.active && r.next_day <= soon).slice(0, 2);

  return (
    <>
      <Link className="hub-tile" href="/money/report">
        <span className="hub-lbl">
          <span className="hub-ico">
            <Icon name="chart" size={16} />
          </span>
          Траты месяца
        </span>
        <span className="hub-big">{money(spend, base, { whole: true })}</span>
        <span className="hub-sub">{delta === null ? 'за этот месяц' : delta === 0 ? 'как в прошлом месяце' : `на ${Math.abs(delta)}% ${delta < 0 ? 'меньше' : 'больше'}, чем в прошлом`}</span>
      </Link>
      <Link className="hub-tile" href="/money/accounts">
        <span className="hub-lbl">
          <span className="hub-ico">
            <Icon name="wallet" size={16} />
          </span>
          На счетах
        </span>
        <span className="hub-big">{money(total, base, { whole: true })}</span>
        {foreign.length > 0 && <span className="hub-sub">в т.ч. {foreign.slice(0, 2).map((a) => money(a.balance_minor, a.currency, { whole: true })).join(' и ')}</span>}
      </Link>
      {budget && (
        <Link className="hub-tile" href="/money/report#budgets">
          <span className="hub-lbl">
            <span className={`hub-ico${budget.spent >= budget.limit_minor * 0.9 ? ' warm' : ''}`}>
              <Icon name="flag" size={16} />
            </span>
            {budget.name}
          </span>
          <span className="hub-big small">{budget.spent >= budget.limit_minor ? `+${money(budget.spent - budget.limit_minor, base, { whole: true })}` : money(budget.limit_minor - budget.spent, base, { whole: true })}</span>
          <span className="hub-sub">{budget.spent >= budget.limit_minor ? 'сверх бюджета' : 'осталось до конца месяца'}</span>
          <span className={`bar${budget.spent >= budget.limit_minor * 0.9 ? ' warm' : ''}`} style={{ marginTop: 'auto' }}>
            <i style={{ width: `${Math.min(100, Math.round((budget.spent / budget.limit_minor) * 100))}%` }} />
          </span>
        </Link>
      )}
      {upcoming.length > 0 && (
        <Link className="hub-tile" href="/money/recurring">
          <span className="hub-lbl">
            <span className="hub-ico">
              <Icon name="repeat" size={16} />
            </span>
            Скоро
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
      )}
    </>
  );
}

function ShoppingTile() {
  const { data } = useApp();
  const items = data.items.filter((i) => i.checklist_id === data.kitchen.shopping_id && !i.done);
  return (
    <Link className="hub-tile" href="/kitchen?tab=shopping">
      <span className="hub-lbl">
        <span className="hub-ico blue">
          <Icon name="cart" size={16} />
        </span>
        Купить
      </span>
      <span className="hub-big">{items.length || '—'}</span>
      <span className="hub-sub">{items.length ? items.slice(0, 3).map((i) => i.title).join(', ') + (items.length > 3 ? ` и ещё ${items.length - 3}` : '') : 'список пуст'}</span>
    </Link>
  );
}

function GymTile({ today }: { today: string }) {
  const { data } = useApp();
  const ws = data.gym.workouts;
  const todays = ws.find((w) => w.day === today);
  const weekAgo = new Date(Date.parse(`${today}T12:00:00`) - 6 * 864e5).toISOString().slice(0, 10);
  const week = ws.filter((w) => w.day >= weekAgo).length;
  const last = [...ws].sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  return (
    <Link className="hub-tile" href="/workouts">
      <span className="hub-lbl">
        <span className="hub-ico blue">
          <Icon name="dumbbell" size={16} />
        </span>
        Тренировки
      </span>
      <span className="hub-big small">{todays ? todays.title : week ? plural(week, 'раз', 'раза', 'раз') : '—'}</span>
      <span className="hub-sub">{todays ? (todays.finished_at ? 'сегодня, завершена' : 'сегодня, идёт') : week ? 'за неделю' : last ? `последняя ${new Date(`${last.day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : 'ещё не было'}</span>
    </Link>
  );
}

function GoalTile({ m }: { m: MoneyState }) {
  const g = m.goals[0];
  if (!g) return null;
  const acc = g.account_id ? m.accounts.find((a) => a.id === g.account_id) : null;
  const rateOf = (c: string) => (c === 'RUB' ? 1 : (m.rates[c] ?? m.user_rates[c]));
  const have = acc ? (convert(Math.max(0, acc.balance_minor), acc.currency, g.currency, rateOf) ?? 0) : g.saved_minor;
  const share = g.target_minor ? Math.min(1, have / g.target_minor) : 0;
  return (
    <Link className="hub-tile wide" href="/money/goals" style={{ minHeight: 0 }}>
      <span className="hub-lbl">
        <span className="hub-ico">
          <Icon name="flag" size={16} />
        </span>
        Цель: {g.name}
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--ink)' }}>
          {money(have, g.currency, { whole: true })} / {money(g.target_minor, g.currency, { whole: true })}
        </span>
      </span>
      <span className="bar" style={{ marginTop: 8 }}>
        <i style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </span>
    </Link>
  );
}
