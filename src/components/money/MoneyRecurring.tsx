'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMinor, money, parseAmount } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import type { MoneyRecurring, RecurCandidate, RecurUnit } from '@/lib/moneyPlans';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { Sheet, shortDay, SubHead } from './MoneyParts';

const UNIT: Record<RecurUnit, [string, string]> = { week: ['каждую неделю', 'недели'], month: ['каждый месяц', 'месяца'], year: ['каждый год', 'года'] };
export const period = (r: Pick<MoneyRecurring, 'unit' | 'every'>) => (r.every === 1 ? UNIT[r.unit][0] : `раз в ${r.every} ${UNIT[r.unit][1]}`);

type Draft = Partial<MoneyRecurring> & { id?: string };

/**
 * Регулярные платежи: подписки, аренда, связь, зарплата. «Записывать сам» —
 * операция появится в свой день; «спросить» — на главной кнопки «Записать»
 * (сумма могла поменяться) и «Пропустить». Ниже — что похоже на подписку.
 */
export default function MoneyRecurringPage() {
  const { data, reload, toast, toBase } = useMoney();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [suggest, setSuggest] = useState<RecurCandidate[]>([]);
  const today = localDay();
  const list = data.recurring;

  useEffect(() => {
    api<{ suggestions: RecurCandidate[] }>('money/recurring/suggest')
      .then((r) => setSuggest(r.suggestions))
      .catch(() => setSuggest([]));
  }, [data.recurring.length]);

  // Сумма за месяц по активным расходам — сколько «съедают» подписки.
  const perMonth = list
    .filter((r) => r.active && r.kind === 'expense')
    .reduce((s, r) => {
      const k = r.unit === 'week' ? 52 / 12 / r.every : r.unit === 'year' ? 1 / (12 * r.every) : 1 / r.every;
      return s + Math.round((toBase(r.amount_minor, r.currency) ?? 0) * k);
    }, 0);

  return (
    <>
      <SubHead title="Регулярные платежи">
        <button className="btn btn-primary" type="button" onClick={() => setEdit({ kind: 'expense', unit: 'month', every: 1, mode: 'ask', next_day: today })}>
          <Icon name="plus" size={18} />
          Платёж
        </button>
      </SubHead>
      <main className="m-main">
        {list.some((r) => r.active && r.kind === 'expense') && (
          <section className="m-card" style={{ gap: 2 }}>
            <div className="muted m-small">Регулярные траты в месяц</div>
            <div className="display m-total">≈ {money(perMonth, data.settings!.base_currency, { trim: true })}</div>
          </section>
        )}
        <DueList />
        {list.length > 0 && (
          <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
            {list.map((r) => (
              <button key={r.id} type="button" className="m-op" onClick={() => setEdit(r)} style={r.active ? undefined : { opacity: 0.5 }}>
                <span className="m-op-ic">
                  <Icon name="repeat" />
                </span>
                <span className="m-op-t">
                  <b>{r.payee}</b>
                  <small>
                    {r.active ? `${shortDay(r.next_day, today)} · ${period(r)}` : 'на паузе'} · {r.mode === 'auto' ? 'запишется сам' : 'спросит'}
                  </small>
                </span>
                <span className={`mono${r.kind === 'income' ? ' m-pos' : ''}`}>{money(r.kind === 'income' ? r.amount_minor : -r.amount_minor, r.currency, { sign: true })}</span>
              </button>
            ))}
          </div>
        )}
        {!list.length && !suggest.length && <p className="muted" style={{ margin: 0 }}>Добавьте подписки, аренду, связь — на главной будет видно, что скоро спишется.</p>}

        {suggest.length > 0 && (
          <>
            <h2 className="group-title">Похоже на регулярные</h2>
            <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
              {suggest.map((c) => (
                <div key={`${c.payee}|${c.kind}`} className="m-op" style={{ cursor: 'default' }}>
                  <span className="m-op-t">
                    <b>{c.payee}</b>
                    <small>
                      {c.count} раза подряд, {c.unit === 'week' ? 'каждую неделю' : 'каждый месяц'} · дальше {shortDay(c.next_day, today)}
                    </small>
                  </span>
                  <span className="mono">{money(c.amount_minor, c.currency)}</span>
                  <button
                    className="btn btn-ghost m-btn-sm"
                    type="button"
                    onClick={() => setEdit({ kind: c.kind, payee: c.payee, amount_minor: c.amount_minor, account_id: c.account_id, category_id: c.category_id, unit: c.unit, every: 1, next_day: c.next_day, mode: 'ask' })}
                  >
                    Добавить
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
      {edit && (
        <RecurSheet
          draft={edit}
          onClose={() => setEdit(null)}
          onSaved={async (msg) => {
            await reload();
            toast(msg);
            setEdit(null);
          }}
        />
      )}
    </>
  );
}

/** Наступившие платежи «спросить» — записать (сумму можно поправить) или пропустить. */
export function DueList({ compact = false }: { compact?: boolean }) {
  const { data, reload, toast } = useMoney();
  const today = localDay();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const due = data.recurring.filter((r) => r.active && r.mode === 'ask' && r.next_day <= today);
  if (!due.length) return null;

  async function act(r: MoneyRecurring, what: 'pay' | 'skip') {
    const raw = amounts[r.id];
    const n = raw !== undefined ? parseAmount(raw, r.currency) : r.amount_minor;
    if (what === 'pay' && !n) return toast('Введите сумму.');
    try {
      await api(`money/recurring/${r.id}`, 'POST', { do: what, amount_minor: n });
      await reload();
      toast(what === 'pay' ? `Записано: ${r.payee}` : `Пропущено: ${r.payee}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <section className="m-card">
      <h2 className="m-card-title">Пора платить</h2>
      {due.map((r) => (
        <div key={r.id} className="m-due">
          <div className="m-row-between">
            <span>
              <b>{r.payee}</b> <span className="muted m-small">· {shortDay(r.next_day, today)}</span>
            </span>
            {compact ? (
              <span className="mono">{money(r.amount_minor, r.currency)}</span>
            ) : (
              <input
                className="field mono m-due-amount"
                inputMode="decimal"
                aria-label={`Сумма: ${r.payee}`}
                value={amounts[r.id] ?? formatMinor(r.amount_minor, r.currency).replace(/\s/g, '')}
                onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value }))}
              />
            )}
          </div>
          <div className="m-row">
            <button className="btn btn-ghost m-btn-sm" type="button" onClick={() => act(r, 'skip')}>
              Пропустить
            </button>
            <button className="btn btn-primary m-btn-sm" type="button" style={{ flex: 1 }} onClick={() => act(r, 'pay')}>
              Записать
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function RecurSheet({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: (msg: string) => void }) {
  const { data } = useMoney();
  const accounts = data.accounts.filter((a) => !a.archived);
  const [kind, setKind] = useState(draft.kind ?? 'expense');
  const [payee, setPayee] = useState(draft.payee ?? '');
  const [accountId, setAccountId] = useState(draft.account_id ?? accounts[0]?.id ?? '');
  const acc = data.accounts.find((a) => a.id === accountId);
  const cur = acc?.currency ?? data.settings!.base_currency;
  const [amount, setAmount] = useState(draft.amount_minor ? formatMinor(draft.amount_minor, cur).replace(/\s/g, '') : '');
  const [categoryId, setCategoryId] = useState(draft.category_id ?? '');
  const [unit, setUnit] = useState<RecurUnit>(draft.unit ?? 'month');
  const [every, setEvery] = useState(String(draft.every ?? 1));
  const [next, setNext] = useState(draft.next_day ?? localDay());
  const [mode, setMode] = useState(draft.mode ?? 'ask');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const n = parseAmount(amount, cur);
    if (!payee.trim()) return setError('Что это за платёж?');
    if (!n) return setError('Введите сумму.');
    setBusy(true);
    try {
      const body = { kind, payee: payee.trim(), account_id: accountId, amount_minor: n, category_id: categoryId || null, unit, every: Number(every) || 1, next_day: next, mode };
      await (draft.id ? api(`money/recurring/${draft.id}`, 'PATCH', body) : api('money/recurring', 'POST', body));
      onSaved(draft.id ? 'Сохранено' : 'Платёж добавлен');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function run(req: Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await req;
      onSaved(msg);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={draft.id ? draft.payee ?? 'Платёж' : 'Регулярный платёж'} onClose={onClose}>
      <div className="seg" role="group" aria-label="Тип" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
          Списание
        </button>
        <button type="button" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
          Поступление
        </button>
      </div>
      <label className="m-field">
        <span className="label">Что это</span>
        <input className="field" value={payee} maxLength={120} placeholder="Spotify, аренда, интернет…" onChange={(e) => setPayee(e.target.value)} />
      </label>
      <div className="m-row">
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">Сумма, {cur}</span>
          <input className="field mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">Счёт</span>
          <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="m-field">
        <span className="label">Категория</span>
        <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Без категории</option>
          {data.categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <div className="m-row">
        <label className="m-field" style={{ width: 90 }}>
          <span className="label">Раз в</span>
          <input className="field mono" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </label>
        <label className="m-field" style={{ flex: 1 }}>
          <span className="label">&nbsp;</span>
          <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as RecurUnit)}>
            <option value="week">неделю</option>
            <option value="month">месяц</option>
            <option value="year">год</option>
          </select>
        </label>
        <label className="m-field" style={{ flex: 1.3 }}>
          <span className="label">Следующий раз</span>
          <input className="field" type="date" value={next} onChange={(e) => e.target.value && setNext(e.target.value)} />
        </label>
      </div>
      <div className="seg" role="group" aria-label="Как записывать" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" aria-pressed={mode === 'ask'} onClick={() => setMode('ask')}>
          Спросить
        </button>
        <button type="button" aria-pressed={mode === 'auto'} onClick={() => setMode('auto')}>
          Записывать сам
        </button>
      </div>
      <p className="muted m-small" style={{ margin: 0 }}>
        {mode === 'auto' ? 'В свой день операция появится сама — для одинаковых сумм: подписки, аренда.' : 'В свой день на главной появятся кнопки «Записать» и «Пропустить» — сумму можно поправить.'}
      </p>
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
      <div className="m-actions">
        {draft.id && (
          <>
            <button className="btn btn-danger-ghost" type="button" disabled={busy} onClick={() => run(api(`money/recurring/${draft.id}`, 'DELETE'), 'Удалено')}>
              Удалить
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(api(`money/recurring/${draft.id}`, 'PATCH', { active: !draft.active }), draft.active ? 'На паузе' : 'Снова работает')}>
              {draft.active ? 'Пауза' : 'Включить'}
            </button>
          </>
        )}
        <button className="btn btn-primary" type="button" disabled={busy} onClick={save} style={{ flex: 1 }}>
          {draft.id ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Sheet>
  );
}
