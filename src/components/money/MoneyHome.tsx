'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { money } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import { useMoney } from './MoneyShell';
import { inScope, monthTitle, OpRow, QuickBar, ScopeSwitch, type Scope } from './MoneyParts';

/**
 * Главная «Денег»: сколько всего на счетах (в основной валюте), счета,
 * траты месяца по категориям и последние операции.
 */
export default function MoneyHome() {
  const { data, toBase, month, setMonth, shown } = useMoney();
  const [scope, setScope] = useState<Scope>('all');
  const base = data.settings!.base_currency;
  const nowMonth = localDay().slice(0, 7);
  // Главная — всегда про текущий месяц (в «Операциях» могли листать назад).
  useEffect(() => {
    if (month !== nowMonth) setMonth(nowMonth);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts = data.accounts.filter((a) => !a.archived && inScope(a, scope));
  let total = 0;
  const noRate = new Set<string>();
  const byCur = new Map<string, number>();
  for (const a of accounts) {
    const v = toBase(a.balance_minor, a.currency);
    if (v === null) noRate.add(a.currency);
    else total += v;
    if (a.currency !== base) byCur.set(a.currency, (byCur.get(a.currency) ?? 0) + a.balance_minor);
  }

  const ids = new Set(accounts.map((a) => a.id));
  const ops = data.ops.filter((o) => ids.has(o.account_id) || (o.to_account_id && ids.has(o.to_account_id)));
  // Траты месяца считает сервер: по курсу на день операции, чек — по категориям позиций.
  const opById = new Map(data.ops.map((o) => [o.id, o]));
  const catName = (id: string | null) => (id ? (data.categories.find((c) => c.id === id)?.name ?? data.ops.find((o) => o.category_id === id)?.category_name ?? 'Категория') : 'Без категории');
  const spent = new Map<string | null, number>();
  let spentTotal = 0;
  for (const p of data.month_parts) {
    const o = opById.get(p.op_id);
    if (!o || !ids.has(o.account_id)) continue;
    spentTotal += p.base_minor;
    spent.set(p.category_id, (spent.get(p.category_id) ?? 0) + p.base_minor);
  }
  const top = [...spent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top[0]?.[1] ?? 1;
  const prevSpend = scope === 'all' ? data.prev_spend.mine + data.prev_spend.family : data.prev_spend[scope];
  const delta = prevSpend > 0 ? Math.round(((spentTotal - prevSpend) / prevSpend) * 100) : null;
  // Бюджеты — про всё, что человек видит, а не про переключатель «Моё/Семья».
  const allSpent = new Map<string | null, number>();
  for (const p of data.month_parts) allSpent.set(p.category_id, (allSpent.get(p.category_id) ?? 0) + p.base_minor);
  const budgets = shown('budgets') ? data.budgets.map((b) => ({ ...b, name: catName(b.category_id), spent: allSpent.get(b.category_id) ?? 0 })).sort((a, b) => b.spent / b.limit_minor - a.spent / a.limit_minor) : [];

  return (
    <>
      <header className="m-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="muted m-small">{monthTitle(nowMonth)}</div>
          <h1 className="display m-h1">Деньги</h1>
        </div>
      </header>
      <main className="m-main m-main-q">
        <ScopeSwitch scope={scope} onChange={setScope} />
        <section className="m-card" style={{ gap: 2 }}>
          <div className="muted m-small">Всего на счетах</div>
          <div className="display m-total">{money(total, base, { trim: true })}</div>
          {shown('currencies') && byCur.size > 0 && (
            <div className="muted m-small">
              в т.ч.{' '}
              {[...byCur.entries()].map(([c, v], i) => (
                <span key={c}>
                  {i > 0 && ' и '}
                  <span className="mono">{money(v, c, { trim: true })}</span>
                </span>
              ))}
              {data.rates_day && ` · по курсу ЦБ на ${new Date(data.rates_day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}
            </div>
          )}
          {noRate.size > 0 && (
            <div className="m-small" style={{ color: 'var(--warm)' }}>
              Без {[...noRate].join(', ')}: нет курса.{' '}
              <Link href="/money/settings">Указать</Link>
            </div>
          )}
        </section>

        {shown('accounts') && accounts.length > 0 && (
          <div className="m-accs">
            {accounts.map((a) => (
              <Link key={a.id} className="m-acc" href="/money/accounts">
                <small>
                  {a.name}
                  {a.shared && <span className="m-tag">семья</span>}
                </small>
                <span className="mono">{money(a.balance_minor, a.currency)}</span>
              </Link>
            ))}
          </div>
        )}

        <section className="m-card">
          <div className="m-card-head">
            <h2 className="m-card-title">Траты за месяц</h2>
            <Link className="m-card-link" href="/money/report">
              Отчёт
            </Link>
          </div>
          <div className="display m-sum">{money(spentTotal, base, { trim: true })}</div>
          {delta !== null && delta !== 0 && (
            <div className="muted m-small" style={{ marginTop: -6 }}>
              на {Math.abs(delta)}% {delta < 0 ? 'меньше' : 'больше'}, чем в прошлом месяце
            </div>
          )}
          {top.map(([id, v]) => (
            <div key={id ?? '-'} className="m-catbar">
              <div className="m-row-between">
                <span>{catName(id)}</span>
                <span className="mono">{money(v, base, { trim: true })}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.max(2, Math.round((v / max) * 100))}%` }} />
              </div>
            </div>
          ))}
          {!top.length && <p className="muted" style={{ margin: 0 }}>В этом месяце трат ещё нет. Напишите внизу, например «кофе 350».</p>}
        </section>

        {budgets.length > 0 && (
          <section className="m-card">
            <div className="m-card-head">
              <h2 className="m-card-title">Бюджеты</h2>
              <Link className="m-card-link" href="/money/report#budgets">
                Изменить
              </Link>
            </div>
            {budgets.map((b) => {
              const share = b.spent / b.limit_minor;
              return (
                <div key={b.category_id} className="m-catbar">
                  <div className="m-row-between">
                    <span>
                      {b.name}
                      {share >= 1 ? <span className="m-tag m-tag-warn">сверх</span> : share >= 0.9 ? <span className="m-tag m-tag-warn">почти всё</span> : null}
                    </span>
                    <span className="mono">
                      {money(b.spent, base, { trim: true })} <span className="muted">/ {money(b.limit_minor, base, { trim: true })}</span>
                    </span>
                  </div>
                  <div className={`bar${share >= 0.9 ? ' warm' : ''}`}>
                    <i style={{ width: `${Math.min(100, Math.max(2, Math.round(share * 100)))}%` }} />
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {ops.length > 0 && (
          <section className="m-card" style={{ gap: 0 }}>
            <div className="m-card-head" style={{ marginBottom: 4 }}>
              <h2 className="m-card-title">Последние</h2>
              <Link className="m-card-link" href="/money/ops">
                Все
              </Link>
            </div>
            {ops.slice(0, 5).map((o) => (
              <OpRow key={o.id} op={o} accounts={data.accounts} />
            ))}
          </section>
        )}
      </main>
      <QuickBar />
    </>
  );
}
