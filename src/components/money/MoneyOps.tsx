'use client';

import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currencies';
import { matchesSearch, searchTerms, type OpItemBrief, type OpKind } from '@/lib/money';
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
/**
 * Категории, по которым считается операция в отчёте: у позиций чека — свои
 * (без своей — категория операции), иначе — категория операции. Как spendParts.
 */
function partCategories(o: { category_id: string | null; items?: OpItemBrief[] }): (string | null)[] {
  if (!o.items?.length) return [o.category_id];
  return o.items.map((i) => i.category_id ?? o.category_id);
}

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
  const { data, month, setMonth, shown, openSearch, toBase } = useMoney();
  const [scope, setScope] = useState<Scope>('all');
  const [filter, setFilter] = useState<'all' | OpKind>('all');
  const [query, setQuery] = useState('');
  // Пришли из ответа ИИ (?q=такси) или из отчёта (?cat=<категория>&month=2026-10).
  const [cat, setCat] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const qq = p.get('q');
    const c = p.get('cat');
    const m = p.get('month');
    if (qq) setQuery(qq);
    if (c) {
      setCat(c);
      setFilter('expense');
    }
    if (m && /^\d{4}-\d{2}$/.test(m) && m !== month && !p.get('op')) setMonth(m);
    if (qq || c) window.history.replaceState(null, '', window.location.pathname);
    // Уже на этом экране — переход по ссылке его не пересоздаст: ловим событие.
    const onFilter = (e: Event) => {
      const d = (e as CustomEvent<{ q?: string }>).detail;
      if (d?.q) {
        setQuery(d.q);
        setCat(null);
      }
    };
    window.addEventListener('money:ops-filter', onFilter);
    return () => window.removeEventListener('money:ops-filter', onFilter);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const catName = cat === 'none' ? 'Без категории' : cat ? (data.categories.find((c) => c.id === cat)?.name ?? data.ops.find((o) => o.category_id === cat)?.category_name ?? 'Категория') : null;

  const q = query.trim();
  const terms = useMemo(() => searchTerms(q), [q]);
  const visible = new Set(data.accounts.filter((a) => inScope(a, scope)).map((a) => a.id));
  // Нашлось в позициях чека — какие именно: покажем их и сколько на них ушло.
  const hits = new Map<string, OpItemBrief[]>();
  const ops = data.ops.filter((o) => {
    if (!(visible.has(o.account_id) || (o.to_account_id && visible.has(o.to_account_id))) || (filter !== 'all' && o.kind !== filter)) return false;
    if (cat && !partCategories(o).includes(cat === 'none' ? null : cat)) return false;
    if (!terms.length) return true;
    if (matchesSearch([o.payee, o.note, o.category_name].filter(Boolean).join(' '), terms)) return true;
    const found = (o.items ?? []).filter((i) => matchesSearch(i.name, terms));
    if (found.length) hits.set(o.id, found);
    return found.length > 0;
  });
  // Итог поиска в основной валюте: позиции — их суммой, остальное — суммой траты.
  let spent = 0;
  let itemCount = 0;
  if (terms.length || cat) {
    for (const o of ops) {
      if (o.kind !== 'expense') continue;
      const found = hits.get(o.id);
      itemCount += found?.length ?? 0;
      spent += found
        ? (toBase(found.reduce((s, i) => s + i.total_minor, 0), o.orig_currency ?? o.currency) ?? 0)
        : (toBase(o.amount_minor, o.currency) ?? 0);
    }
  }
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
        <input className="field" type="search" aria-label="Поиск по операциям" placeholder="Магазин, товар из чека, категория" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="m-chips m-scroll">
          {filters.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {catName && (
          <div className="m-chips">
            <span className="chip" aria-pressed="true">
              Категория: {catName}
              <button className="chip-x" type="button" aria-label="Показать все категории" onClick={() => setCat(null)}>
                <Icon name="x" size={14} />
              </button>
            </span>
          </div>
        )}
        {(terms.length > 0 || cat) && spent > 0 && (
          <p className="m-search-sum">
            Потрачено за {monthTitle(month).toLowerCase()}: <b className="mono">{money(spent, data.settings!.base_currency)}</b>
            {itemCount > 0 && <span className="muted"> · в чеках {itemCount} поз.</span>}
          </p>
        )}
        {days.map((g) => (
          <section key={g.day} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 className="group-title">{dayLabel(g.day)}</h2>
            <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
              {g.list.map((o) => (
                <OpRow key={o.id} op={o} accounts={data.accounts} found={hits.get(o.id)} />
              ))}
            </div>
          </section>
        ))}
        {!days.length && <p className="muted" style={{ textAlign: 'center', margin: '24px 0' }}>{q || cat || filter !== 'all' ? 'Ничего не нашлось.' : 'В этом месяце операций нет.'}</p>}
      </main>
      <QuickBar />
    </>
  );
}
