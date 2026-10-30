'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatMinor, money, parseAmount } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import type { MoneyDebt } from '@/lib/moneyPlans';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { Sheet, shortDay, SubHead } from './MoneyParts';

/**
 * Долги: кому дал и у кого взял. Деньги через счёт — операции с пометкой
 * долга: остаток счёта верный, а в отчёты о тратах они не попадают.
 */
export default function MoneyDebts() {
  const { data } = useMoney();
  const [add, setAdd] = useState(false);
  const [pay, setPay] = useState<MoneyDebt | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const today = localDay();
  const open = data.debts.filter((x) => !x.closed);
  const closed = data.debts.filter((x) => x.closed);
  const group = (dir: MoneyDebt['direction']) => open.filter((x) => x.direction === dir);

  const row = (x: MoneyDebt) => {
    const left = x.amount_minor - x.paid_minor;
    const late = x.due_day && x.due_day < today && !x.closed;
    return (
      <button key={x.id} type="button" className="m-op" onClick={() => setPay(x)}>
        <span className="m-op-t">
          <b>{x.person}</b>
          <small>
            {x.paid_minor > 0 && !x.closed ? `вернули ${money(x.paid_minor, x.currency, { trim: true })} из ${money(x.amount_minor, x.currency, { trim: true })} · ` : ''}
            {x.closed ? 'закрыт' : x.due_day ? <span className={late ? 'm-up' : undefined}>{late ? 'просрочен с ' : 'до '}{shortDay(x.due_day, today)}</span> : `с ${shortDay(x.day, today)}`}
          </small>
        </span>
        <span className="mono">{money(x.closed ? x.amount_minor : left, x.currency, { trim: true })}</span>
      </button>
    );
  };

  return (
    <>
      <SubHead title="Долги">
        <button className="btn btn-primary" type="button" onClick={() => setAdd(true)}>
          <Icon name="plus" size={18} />
          Долг
        </button>
      </SubHead>
      <main className="m-main">
        {!open.length && <p className="muted" style={{ margin: 0 }}>Долгов нет. Записывайте, кому одолжили и у кого заняли, — с напоминанием о сроке.</p>}
        {(['lent', 'borrowed'] as const).map((dir) =>
          group(dir).length ? (
            <section key={dir} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 className="group-title">{dir === 'lent' ? 'Мне должны' : 'Я должен'}</h2>
              <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
                {group(dir).map(row)}
              </div>
            </section>
          ) : null,
        )}
        {closed.length > 0 && (
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? 'Скрыть закрытые' : `Закрытые · ${closed.length}`}
            </button>
            {showClosed && (
              <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
                {closed.map(row)}
              </div>
            )}
          </>
        )}
      </main>
      {add && <DebtSheet onClose={() => setAdd(false)} />}
      {pay && <PaySheet debt={pay} onClose={() => setPay(null)} />}
    </>
  );
}

function DebtSheet({ onClose }: { onClose: () => void }) {
  const { data, reload, toast } = useMoney();
  const accounts = data.accounts.filter((a) => !a.archived);
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [cur, setCur] = useState(data.settings!.base_currency);
  const [day, setDay] = useState(localDay());
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const code = accountId ? (data.accounts.find((a) => a.id === accountId)?.currency ?? cur) : cur;

  async function save() {
    setError(null);
    const n = parseAmount(amount, code);
    if (!person.trim()) return setError('Кто?');
    if (!n) return setError('Введите сумму.');
    try {
      await api('money/debts', 'POST', { direction, person: person.trim(), amount_minor: n, account_id: accountId || null, currency: code, day, due_day: due || null });
      await reload();
      toast('Долг записан');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Sheet title="Новый долг" onClose={onClose}>
      <div className="seg" role="group" aria-label="Кто кому" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" aria-pressed={direction === 'lent'} onClick={() => setDirection('lent')}>
          Я дал в долг
        </button>
        <button type="button" aria-pressed={direction === 'borrowed'} onClick={() => setDirection('borrowed')}>
          Я взял в долг
        </button>
      </div>
      <label className="m-field">
        <span className="label">{direction === 'lent' ? 'Кому' : 'У кого'}</span>
        <input className="field" value={person} maxLength={80} placeholder="Саша" onChange={(e) => setPerson(e.target.value)} />
      </label>
      <div className="m-row">
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">Сумма, {code}</span>
          <input className="field mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="m-field" style={{ flex: 1.2 }}>
          <span className="label">Через счёт</span>
          <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
            <option value="">Без счёта</option>
          </select>
        </label>
      </div>
      {!accountId && (
        <label className="m-field">
          <span className="label">Валюта</span>
          <select className="field" value={cur} onChange={(e) => setCur(e.target.value)}>
            {[data.settings!.base_currency, ...data.settings!.currencies].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <div className="m-row">
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">Когда</span>
          <input className="field" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">Вернуть до</span>
          <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <p className="muted m-small" style={{ margin: 0 }}>
        {accountId ? 'Деньги уйдут или придут на счёт, но в тратах и доходах их не будет — это долг.' : 'Только запись — остатки счетов не меняются.'}
      </p>
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="button" onClick={save}>
        Записать
      </button>
    </Sheet>
  );
}

function PaySheet({ debt, onClose }: { debt: MoneyDebt; onClose: () => void }) {
  const { data, reload, toast } = useMoney();
  const accounts = data.accounts.filter((a) => !a.archived);
  const left = debt.amount_minor - debt.paid_minor;
  const [amount, setAmount] = useState(formatMinor(Math.max(0, left), debt.currency).replace(/\s/g, ''));
  const [accountId, setAccountId] = useState(accounts.find((a) => a.currency === debt.currency)?.id ?? accounts[0]?.id ?? '');
  const acc = data.accounts.find((a) => a.id === accountId);
  const [accAmount, setAccAmount] = useState('');
  const [day, setDay] = useState(localDay());
  const [error, setError] = useState<string | null>(null);
  const foreign = acc && acc.currency !== debt.currency;

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
  function payBack() {
    setError(null);
    const n = parseAmount(amount, debt.currency);
    if (!n) return setError('Введите сумму.');
    const a = foreign ? parseAmount(accAmount, acc!.currency) : null;
    if (foreign && !a) return setError(`Сколько в ${acc!.currency} прошло по счёту?`);
    run(api(`money/debts/${debt.id}`, 'POST', { do: 'pay', amount_minor: n, account_id: accountId, day, account_amount_minor: a }), 'Возврат записан');
  }

  return (
    <Sheet title={`${debt.direction === 'lent' ? 'Мне должен' : 'Я должен'}: ${debt.person}`} onClose={onClose}>
      <div className="m-kv-box">
        <div className="m-kv">
          <span className="muted">Было</span>
          <span className="mono">{money(debt.amount_minor, debt.currency)}</span>
        </div>
        <div className="m-kv">
          <span className="muted">Вернули</span>
          <span className="mono">{money(debt.paid_minor, debt.currency)}</span>
        </div>
        <div className="m-kv">
          <span className="muted">Осталось</span>
          <span className="mono" style={{ fontWeight: 600 }}>
            {money(Math.max(0, left), debt.currency)}
          </span>
        </div>
      </div>
      {!debt.closed && (
        <>
          <div className="m-row">
            <label className="m-field" style={{ flex: 1 }}>
              <span className="label">Вернули, {debt.currency}</span>
              <input className="field mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="m-field" style={{ flex: 1.2 }}>
              <span className="label">На какой счёт</span>
              <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {foreign && (
            <label className="m-field">
              <span className="label">Сколько прошло по счёту, {acc!.currency}</span>
              <input className="field mono" inputMode="decimal" value={accAmount} onChange={(e) => setAccAmount(e.target.value)} />
            </label>
          )}
          <label className="m-field">
            <span className="label">Когда</span>
            <input className="field" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
        </>
      )}
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
      <div className="m-actions">
        <button className="btn btn-danger-ghost" type="button" onClick={() => run(api(`money/debts/${debt.id}`, 'DELETE'), 'Долг удалён')}>
          Удалить
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => run(api(`money/debts/${debt.id}`, 'PATCH', { closed: !debt.closed }), debt.closed ? 'Долг открыт' : 'Долг закрыт')}>
          {debt.closed ? 'Открыть' : 'Закрыть'}
        </button>
        {!debt.closed && (
          <button className="btn btn-primary" type="button" style={{ flex: 1 }} onClick={payBack}>
            Вернули
          </button>
        )}
      </div>
    </Sheet>
  );
}
