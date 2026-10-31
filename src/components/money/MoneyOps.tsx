'use client';

import { useState } from 'react';
import type { OpKind } from '@/lib/money';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { inScope, monthTitle, OpRow, QuickBar, ScopeSwitch, shiftMonth, type Scope } from './MoneyParts';

const FILTERS: { id: 'all' | OpKind; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'expense', label: 'Расходы' },
  { id: 'income', label: 'Доходы' },
  { id: 'transfer', label: 'Переводы' },
  { id: 'exchange', label: 'Обмены' },
];

/** «Сегодня, 30 окт», «Вчера, 29 окт», «Пн, 27 окт». */
function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  if (diff === 0) return `Сегодня, ${date}`;
  if (diff === 1) return `Вчера, ${date}`;
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${date}`;
}

/** Все операции месяца: поиск, фильтр по типу, по дням. */
export default function MoneyOps() {
  const { data, month, setMonth, shown, openSearch } = useMoney();
  const [scope, setScope] = useState<Scope>('all');
  const [filter, setFilter] = useState<'all' | OpKind>('all');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const visible = new Set(data.accounts.filter((a) => inScope(a, scope)).map((a) => a.id));
  const ops = data.ops.filter(
    (o) =>
      (visible.has(o.account_id) || (o.to_account_id && visible.has(o.to_account_id))) &&
      (filter === 'all' || o.kind === filter) &&
      (!q || [o.payee, o.note, o.category_name].some((s) => s?.toLowerCase().includes(q))),
  );
  const days: { day: string; list: typeof ops }[] = [];
  for (const o of ops) {
    const last = days[days.length - 1];
    if (last?.day === o.day) last.list.push(o);
    else days.push({ day: o.day, list: [o] });
  }
  const filters = FILTERS.filter((f) => (f.id === 'transfer' ? shown('accounts') : f.id === 'exchange' ? shown('currencies') : true));

  return (
    <>
      <header className="m-head">
        <h1 className="display m-h1" style={{ flex: 1 }}>
          Операции
        </h1>
        <button className="icon-btn bare m-search" type="button" onClick={openSearch} aria-label="Поиск">
          <Icon name="search" />
        </button>
      </header>
      <main className="m-main m-main-q">
        <div className="m-month">
          <button className="icon-btn bare" type="button" aria-label="Прошлый месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="back" />
          </button>
          <span style={{ fontWeight: 600 }}>{monthTitle(month)}</span>
          <button className="icon-btn bare m-flip" type="button" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>
            <Icon name="back" />
          </button>
        </div>
        <ScopeSwitch scope={scope} onChange={setScope} />
        <input className="field" type="search" aria-label="Поиск по операциям" placeholder="Магазин, заметка, категория" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="m-chips m-scroll">
          {filters.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {days.map((g) => (
          <section key={g.day} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 className="group-title">{dayLabel(g.day)}</h2>
            <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
              {g.list.map((o) => (
                <OpRow key={o.id} op={o} accounts={data.accounts} />
              ))}
            </div>
          </section>
        ))}
        {!days.length && <p className="muted" style={{ textAlign: 'center', margin: '24px 0' }}>{q || filter !== 'all' ? 'Ничего не нашлось.' : 'В этом месяце операций нет.'}</p>}
      </main>
      <QuickBar />
    </>
  );
}
