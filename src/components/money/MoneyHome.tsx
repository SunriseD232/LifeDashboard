'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMinor, money, parseAmount } from '@/lib/currencies';
import { localDay, plural } from '@/lib/dates';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { inScope, monthTitle, OpRow, QuickBar, ScopeSwitch, shortDay, type Scope } from './MoneyParts';
import { DueList } from './MoneyRecurring';
import { useGoalProgress } from './MoneyGoals';

/**
 * Главная «Денег»: сколько всего на счетах (в основной валюте), счета,
 * траты месяца по категориям и последние операции.
 */
export default function MoneyHome() {
  const { data, toBase, month, setMonth, shown, openSearch } = useMoney();
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
  // Итог дня: траты сегодня по видимым счетам (в основной валюте, как месяц).
  const today = localDay();
  let todaySum = 0;
  const todayOps = new Set<string>();
  for (const p of data.month_parts) {
    const o = opById.get(p.op_id);
    if (!o || o.day !== today || !ids.has(o.account_id)) continue;
    todaySum += p.base_minor;
    todayOps.add(o.id);
  }
  const top = [...spent.entries()].sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : b[1] - a[1])).slice(0, 5);
  const max = Math.max(1, ...top.map(([, v]) => v));
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
        <button className="icon-btn bare m-search" type="button" onClick={openSearch} aria-label="Поиск">
          <Icon name="search" />
        </button>
      </header>
      <main className="m-main m-main-q">
        <ScopeSwitch scope={scope} onChange={setScope} />
        <section className="m-card" style={{ gap: 2 }}>
          <div className="muted m-small">Всего на счетах</div>
          <div className="display m-total">{money(total, base, { whole: true })}</div>
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
          <div className="display m-sum">{money(spentTotal, base, { whole: true })}</div>
          {delta !== null && delta !== 0 && (
            <div className="muted m-small" style={{ marginTop: -6 }}>
              на {Math.abs(delta)}% {delta < 0 ? 'меньше' : 'больше'}, чем в прошлом месяце
            </div>
          )}
          {top.map(([id, v]) => (
            <div key={id ?? '-'} className={`m-catbar${id === null ? ' m-catbar-none' : ''}`}>
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
                Изменить<span className="sr-only"> бюджеты</span>
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

        {data.family && <FamilyBudget />}

        {shown('recurring') && <DueList />}
        {shown('recurring') && <Upcoming />}
        {shown('goals') && <GoalsCard />}
        {shown('debts') && <DebtsCard />}

        {ops.length > 0 && (
          <section className="m-card" style={{ gap: 0 }}>
            <div className="m-card-head" style={{ marginBottom: 4 }}>
              <h2 className="m-card-title">Последние</h2>
              <Link className="m-card-link" href="/money/ops">
                Все<span className="sr-only"> операции</span>
              </Link>
            </div>
            <div className="m-today m-small">
              {todayOps.size ? (
                <>
                  Сегодня: <span className="mono">{money(todaySum, base, { whole: true })}</span> · {plural(todayOps.size, 'трата', 'траты', 'трат')}
                </>
              ) : (
                <span className="muted">Сегодня трат пока нет</span>
              )}
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

/** Что спишется в ближайшие две недели. */
function Upcoming() {
  const { data } = useMoney();
  const today = localDay();
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const list = data.recurring.filter((r) => r.active && r.next_day <= soon && !(r.mode === 'ask' && r.next_day <= today)).slice(0, 5);
  if (!list.length) return null;
  return (
    <section className="m-card" style={{ gap: 0 }}>
      <div className="m-card-head" style={{ marginBottom: 4 }}>
        <h2 className="m-card-title">Скоро списания</h2>
        <Link className="m-card-link" href="/money/recurring">
          Все<span className="sr-only"> списания</span>
        </Link>
      </div>
      {list.map((r) => (
        <div key={r.id} className="m-kv m-kv-row">
          <span>
            <span className="muted m-small">{shortDay(r.next_day, today)}</span> {r.payee}
          </span>
          <span className={`mono${r.kind === 'income' ? ' m-pos' : ''}`}>{money(r.amount_minor, r.currency, { trim: true })}</span>
        </div>
      ))}
    </section>
  );
}

function GoalsCard() {
  const { data } = useMoney();
  const progress = useGoalProgress();
  if (!data.goals.length) return null;
  return (
    <section className="m-card">
      <div className="m-card-head">
        <h2 className="m-card-title">Цели</h2>
        <Link className="m-card-link" href="/money/goals">
          Все<span className="sr-only"> цели</span>
        </Link>
      </div>
      {data.goals.slice(0, 3).map((g) => {
        const p = progress(g);
        return (
          <div key={g.id} className="m-catbar">
            <div className="m-row-between">
              <span>{g.name}</span>
              <span className="mono">
                {money(p.have, g.currency, { trim: true })} <span className="muted">/ {money(g.target_minor, g.currency, { trim: true })}</span>
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.max(2, Math.round(p.share * 100))}%` }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Итог по долгам в основной валюте: сколько должны мне и сколько я. */
function DebtsCard() {
  const { data, toBase } = useMoney();
  const open = data.debts.filter((x) => !x.closed);
  if (!open.length) return null;
  const base = data.settings!.base_currency;
  const sum = (dir: 'lent' | 'borrowed') => open.filter((x) => x.direction === dir).reduce((s, x) => s + (toBase(x.amount_minor - x.paid_minor, x.currency) ?? 0), 0);
  const late = open.filter((x) => x.due_day && x.due_day < localDay()).length;
  return (
    <Link className="m-card m-debts" href="/money/debts">
      <h2 className="m-card-title">Долги</h2>
      <div className="m-row-between">
        <span className="muted">Мне должны</span>
        <span className="mono">{money(sum('lent'), base, { trim: true })}</span>
      </div>
      <div className="m-row-between">
        <span className="muted">Я должен</span>
        <span className="mono">{money(sum('borrowed'), base, { trim: true })}</span>
      </div>
      {late > 0 && <small className="m-up">Просрочено: {late}</small>}
    </Link>
  );
}

/**
 * Бюджет семьи на месяц: все траты с семейных счетов, кто бы ни тратил.
 * Задаёт и меняет любой в семье; сумма — в валюте того, кто задал, на
 * экране — в своей основной.
 */
function FamilyBudget() {
  const { data, toBase, reload, toast } = useMoney();
  const base = data.settings!.base_currency;
  const fb = data.family_budget;
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const sharedAcc = new Set(data.accounts.filter((a) => a.shared).map((a) => a.id));
  const opById = new Map(data.ops.map((o) => [o.id, o]));
  let spent = 0;
  for (const p of data.month_parts) {
    const o = opById.get(p.op_id);
    if (o && sharedAcc.has(o.account_id)) spent += p.base_minor;
  }
  const limit = fb ? toBase(fb.limit_minor, fb.currency) : null;

  const save = async (value: number | null) => {
    try {
      await api('money/family-budget', 'PUT', { limit_minor: value, currency: base });
      await reload();
      setEditing(false);
      toast(value === null ? 'Бюджет семьи убран' : 'Бюджет семьи сохранён');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!fb && !editing) {
    if (!sharedAcc.size) return null;
    return (
      <section className="m-card">
        <div className="m-card-head">
          <h2 className="m-card-title">Бюджет семьи</h2>
          <button className="m-card-link m-link-btn" type="button" onClick={() => setEditing(true)}>
            Задать
          </button>
        </div>
        <small className="muted">С семейных счетов в этом месяце: {money(spent, base, { trim: true })}. Задайте, сколько можно на месяц всем вместе.</small>
      </section>
    );
  }

  const share = limit ? spent / limit : 0;
  return (
    <section className="m-card">
      <div className="m-card-head">
        <h2 className="m-card-title">
          Бюджет семьи
          {limit !== null && (share >= 1 ? <span className="m-tag m-tag-warn">сверх</span> : share >= 0.9 ? <span className="m-tag m-tag-warn">почти всё</span> : null)}
        </h2>
        {!editing && (
          <button
            className="m-card-link m-link-btn"
            type="button"
            onClick={() => {
              setRaw(fb ? formatMinor(fb.limit_minor, fb.currency).replace(/\s/g, '') : '');
              setEditing(true);
            }}
          >
            Изменить
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="m-row"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseAmount(raw, base);
            if (n && n > 0) save(n);
          }}
        >
          <input className="field mono" inputMode="decimal" placeholder={`В месяц, ${base}`} aria-label="Бюджет семьи на месяц" value={raw} onChange={(e) => setRaw(e.target.value)} style={{ flex: 1 }} autoFocus />
          {fb && (
            <button className="btn btn-ghost" type="button" onClick={() => save(null)}>
              Убрать
            </button>
          )}
          <button className="btn btn-primary" type="submit" disabled={!raw.trim()}>
            Сохранить
          </button>
        </form>
      ) : (
        <>
          <div className="m-row-between">
            <span className="muted m-small">С семейных счетов за месяц</span>
            <span className="mono">
              {money(spent, base, { trim: true })} <span className="muted">/ {limit !== null ? money(limit, base, { trim: true }) : money(fb!.limit_minor, fb!.currency, { trim: true })}</span>
            </span>
          </div>
          <div className={`bar${share >= 0.9 ? ' warm' : ''}`}>
            <i style={{ width: `${Math.min(100, Math.max(2, Math.round(share * 100)))}%` }} />
          </div>
        </>
      )}
    </section>
  );
}
