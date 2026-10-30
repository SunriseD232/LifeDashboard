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
  const spent = new Map<string, number>();
  let spentTotal = 0;
  for (const o of ops) {
    if (o.kind !== 'expense' || !ids.has(o.account_id)) continue;
    const v = toBase(o.amount_minor, o.currency) ?? 0;
    spentTotal += v;
    const k = o.category_name ?? 'Без категории';
    spent.set(k, (spent.get(k) ?? 0) + v);
  }
  const top = [...spent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top[0]?.[1] ?? 1;

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
          </div>
          <div className="display m-sum">{money(spentTotal, base, { trim: true })}</div>
          {top.map(([name, v]) => (
            <div key={name} className="m-catbar">
              <div className="m-row-between">
                <span>{name}</span>
                <span className="mono">{money(v, base, { trim: true })}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.max(2, Math.round((v / max) * 100))}%` }} />
              </div>
            </div>
          ))}
          {!top.length && <p className="muted" style={{ margin: 0 }}>В этом месяце трат ещё нет. Напишите внизу, например «кофе 350».</p>}
        </section>

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
