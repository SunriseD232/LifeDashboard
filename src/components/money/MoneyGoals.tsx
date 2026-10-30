'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { convert } from '@/lib/money';
import { formatMinor, money, parseAmount } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import { monthlyNeed, type MoneyGoal } from '@/lib/moneyPlans';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { Sheet, SubHead } from './MoneyParts';

/** Сколько уже есть на цель: остаток счёта (в валюте цели) или отложенное вручную. */
export function useGoalProgress() {
  const { data, rateOf } = useMoney();
  return (g: MoneyGoal) => {
    const acc = g.account_id ? data.accounts.find((a) => a.id === g.account_id) : null;
    const have = acc ? (convert(Math.max(0, acc.balance_minor), acc.currency, g.currency, rateOf) ?? 0) : g.saved_minor;
    return { have, share: g.target_minor ? Math.min(1, have / g.target_minor) : 0, need: monthlyNeed(g.target_minor - have, localDay(), g.due_day), account: acc };
  };
}

/** Цели: на что копим, сколько уже есть, сколько откладывать в месяц, чтобы успеть. */
export default function MoneyGoals() {
  const { data, reload, toast } = useMoney();
  const progress = useGoalProgress();
  const [edit, setEdit] = useState<MoneyGoal | 'new' | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});

  async function addTo(g: MoneyGoal, sign: 1 | -1) {
    const n = parseAmount(adding[g.id] ?? '', g.currency);
    if (!n) return toast('Сколько отложили?');
    try {
      await api(`money/goals/${g.id}`, 'PATCH', { add_minor: sign * n });
      await reload();
      setAdding((a) => ({ ...a, [g.id]: '' }));
      toast(sign > 0 ? 'Отложено' : 'Взято из цели');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <SubHead title="Цели">
        <button className="btn btn-primary" type="button" onClick={() => setEdit('new')}>
          <Icon name="plus" size={18} />
          Цель
        </button>
      </SubHead>
      <main className="m-main">
        {!data.goals.length && <p className="muted" style={{ margin: 0 }}>Копите на отпуск, подушку или ремонт? Задайте сумму и срок — будет видно, сколько откладывать в месяц.</p>}
        {data.goals.map((g) => {
          const p = progress(g);
          return (
            <section key={g.id} className="m-card">
              <div className="m-card-head">
                <h2 className="m-card-title">{g.name}</h2>
                <button className="m-card-link m-link-btn" type="button" onClick={() => setEdit(g)}>
                  Изменить
                </button>
              </div>
              <div className="m-row-between">
                <span className="display m-sum">{money(p.have, g.currency, { trim: true })}</span>
                <span className="muted mono">из {money(g.target_minor, g.currency, { trim: true })}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.max(2, Math.round(p.share * 100))}%` }} />
              </div>
              <small className="muted">
                {p.share >= 1
                  ? 'Цель достигнута 🎉'
                  : [p.account ? `на счёте «${p.account.name}»` : null, p.need ? `откладывать по ${money(p.need, g.currency, { trim: true })} в месяц` : null, g.due_day ? `к ${new Date(`${g.due_day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : null]
                      .filter(Boolean)
                      .join(' · ')}
              </small>
              {!p.account && p.share < 1 && (
                <div className="m-row">
                  <input className="field mono" inputMode="decimal" placeholder="Сколько" aria-label={`Отложить на «${g.name}»`} value={adding[g.id] ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [g.id]: e.target.value }))} style={{ flex: 1 }} />
                  <button className="btn btn-ghost" type="button" aria-label="Взять обратно" onClick={() => addTo(g, -1)}>
                    −
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => addTo(g, 1)}>
                    Отложить
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </main>
      {edit && <GoalSheet goal={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function GoalSheet({ goal, onClose }: { goal: MoneyGoal | null; onClose: () => void }) {
  const { data, reload, toast } = useMoney();
  const accounts = data.accounts.filter((a) => !a.archived && a.mine);
  const [name, setName] = useState(goal?.name ?? '');
  const [accountId, setAccountId] = useState(goal?.account_id ?? '');
  const [cur, setCur] = useState(goal?.currency ?? data.settings!.base_currency);
  const code = accountId ? (data.accounts.find((a) => a.id === accountId)?.currency ?? cur) : cur;
  const [target, setTarget] = useState(goal ? formatMinor(goal.target_minor, goal.currency).replace(/\s/g, '') : '');
  const [saved, setSaved] = useState('');
  const [due, setDue] = useState(goal?.due_day ?? '');
  const [error, setError] = useState<string | null>(null);

  async function run(req: Promise<unknown>, msg: string) {
    try {
      await req;
      await reload();
      toast(msg);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function save() {
    setError(null);
    const t = parseAmount(target, code);
    if (!name.trim()) return setError('На что копим?');
    if (!t) return setError('Сколько нужно?');
    const body = { name: name.trim(), target_minor: t, account_id: accountId || null, currency: code, due_day: due || null, saved_minor: parseAmount(saved, code) ?? 0 };
    run(goal ? api(`money/goals/${goal.id}`, 'PATCH', body) : api('money/goals', 'POST', body), goal ? 'Сохранено' : 'Цель добавлена');
  }

  return (
    <Sheet title={goal ? goal.name : 'Новая цель'} onClose={onClose}>
      <label className="m-field">
        <span className="label">На что</span>
        <input className="field" value={name} maxLength={80} placeholder="Отпуск, подушка безопасности…" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="m-field">
        <span className="label">Где копим</span>
        <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Отмечаю вручную</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              На счёте «{a.name}» · {a.currency}
            </option>
          ))}
        </select>
        <span className="muted m-small">{accountId ? 'Прогресс — остаток этого счёта.' : 'Нажимайте «Отложить», когда откладываете.'}</span>
      </label>
      <div className="m-row">
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">Сколько нужно</span>
          <input className="field mono" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        {!accountId && (
          <label className="m-field" style={{ width: 100 }}>
            <span className="label">Валюта</span>
            <select className="field" value={cur} onChange={(e) => setCur(e.target.value)}>
              {[data.settings!.base_currency, ...data.settings!.currencies].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!goal && !accountId && (
        <label className="m-field">
          <span className="label">Уже отложено</span>
          <input className="field mono" inputMode="decimal" placeholder="0" value={saved} onChange={(e) => setSaved(e.target.value)} />
        </label>
      )}
      <label className="m-field">
        <span className="label">К какому сроку (необязательно)</span>
        <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
      <div className="m-actions">
        {goal && (
          <button className="btn btn-danger-ghost" type="button" onClick={() => run(api(`money/goals/${goal.id}`, 'PATCH', { archived: true }), 'Цель убрана')}>
            Убрать
          </button>
        )}
        <button className="btn btn-primary" type="button" onClick={save} style={{ flex: 1 }}>
          {goal ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Sheet>
  );
}
