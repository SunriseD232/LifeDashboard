'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { currency, formatMinor, money, parseAmount } from '@/lib/currencies';
import { addDays, localDay } from '@/lib/dates';
import { convert, exchangeRate, type MoneyOp, type OpKind } from '@/lib/money';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';

/** Черновик новой операции — из быстрого ввода или кнопки «+». */
export interface OpDraft {
  kind?: OpKind;
  amount_minor?: number | null;
  /** Валюта суммы из быстрого ввода («12 €»), если её назвали. */
  currency?: string | null;
  payee?: string;
  day?: string;
  account_id?: string;
  category_id?: string | null;
  source?: string;
}

const KINDS: { id: OpKind; label: string }[] = [
  { id: 'expense', label: 'Расход' },
  { id: 'income', label: 'Доход' },
  { id: 'transfer', label: 'Перевод' },
  { id: 'exchange', label: 'Обмен' },
];

const LAST_ACCOUNT = 'money:lastAccount';

function lastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT);
  } catch {
    return null;
  }
}

/** Сумма для поля ввода: 123450 → «1234,50» (без пробелов — их удобнее править). */
const editable = (minor: number | null | undefined, code: string) => (minor ? formatMinor(minor, code).replace(/ /g, '') : '');

/**
 * Окно операции: расход, доход, перевод между своими счетами или обмен
 * валюты. Новая — из черновика, существующую можно поправить или удалить.
 */
export default function OpSheet({ op, onClose }: { op: MoneyOp | OpDraft | null; onClose: () => void }) {
  const { data, reload, toast, rateOf, shown } = useMoney();
  const existing = op && 'id' in op ? (op as MoneyOp) : null;
  const draft = (existing ? {} : op ?? {}) as OpDraft;
  const base = data.settings!.base_currency;

  const usable = data.accounts.filter((a) => !a.archived || a.id === existing?.account_id || a.id === existing?.to_account_id);
  const byId = (id: string | null | undefined) => data.accounts.find((a) => a.id === id);

  // Счёт по умолчанию: из черновика; валюту назвали — счёт в ней; иначе последний.
  const initialAccount = (() => {
    if (existing) return existing.account_id;
    if (draft.account_id && byId(draft.account_id)) return draft.account_id;
    if (draft.currency) {
      const inCur = usable.find((a) => a.currency === draft.currency);
      if (inCur) return inCur.id;
    }
    const last = lastAccount();
    return usable.find((a) => a.id === last)?.id ?? usable[0]?.id ?? '';
  })();
  const startCur = byId(initialAccount)?.currency ?? base;
  // Валюту назвали, а счёта в ней нет — это покупка в другой валюте.
  const foreignDraft = !existing && draft.currency && draft.currency !== startCur ? draft.currency : null;

  const [kind, setKind] = useState<OpKind>(existing?.kind ?? draft.kind ?? 'expense');
  const [accountId, setAccountId] = useState(initialAccount);
  const [amountText, setAmountText] = useState(
    existing ? editable(existing.amount_minor, existing.currency) : foreignDraft ? editable(convert(draft.amount_minor ?? 0, foreignDraft, startCur, rateOf), startCur) : editable(draft.amount_minor, startCur),
  );
  const [toAccountId, setToAccountId] = useState(existing?.to_account_id ?? '');
  const [toAmountText, setToAmountText] = useState(existing?.to_amount_minor ? editable(existing.to_amount_minor, existing.to_currency ?? base) : '');
  const [categoryId, setCategoryId] = useState<string | null>(existing ? existing.category_id : draft.category_id ?? null);
  const [payee, setPayee] = useState(existing?.payee ?? draft.payee ?? '');
  const [day, setDay] = useState(existing?.day ?? draft.day ?? localDay());
  const [note, setNote] = useState(existing?.note ?? '');
  const [origOn, setOrigOn] = useState(!!existing?.orig_currency || !!foreignDraft);
  const [origCur, setOrigCur] = useState(existing?.orig_currency ?? foreignDraft ?? data.settings!.currencies.find((c) => c !== startCur) ?? 'USD');
  const [origText, setOrigText] = useState(existing?.orig_amount_minor ? editable(existing.orig_amount_minor, existing.orig_currency!) : foreignDraft ? editable(draft.amount_minor, foreignDraft) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const acc = byId(accountId);
  const cur = acc?.currency ?? base;
  const toAcc = byId(toAccountId);
  const amount = parseAmount(amountText, cur);
  const toAmount = toAcc ? parseAmount(toAmountText, toAcc.currency) : null;
  const origAmount = parseAmount(origText, origCur);

  // Варианты типа: перевод — когда счетов больше одного, обмен — когда есть валюты.
  const kinds = KINDS.filter((k) => (k.id === 'transfer' ? shown('accounts') && usable.length > 1 : k.id === 'exchange' ? shown('currencies') && usable.length > 1 : true));
  const targets = usable.filter((a) => a.id !== accountId && (kind === 'transfer' ? a.currency === cur : kind === 'exchange' ? a.currency !== cur : false));
  useEffect(() => {
    if ((kind === 'transfer' || kind === 'exchange') && !targets.some((a) => a.id === toAccountId)) setToAccountId(targets[0]?.id ?? '');
  }, [kind, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = data.categories.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense'));
  // Категория чужой семейной операции — показываем её тоже, чтобы не потерять.
  const foreignCat = existing?.category_id && !cats.some((c) => c.id === existing.category_id) && existing.category_name ? { id: existing.category_id, name: existing.category_name } : null;

  const approx = amount && cur !== base ? convert(amount, cur, base, rateOf) : null;
  const origHint = origOn && origAmount && origCur !== cur ? convert(origAmount, origCur, cur, rateOf) : null;
  const exchange = useMemo(() => {
    if (kind !== 'exchange' || !amount || !toAmount || !toAcc) return null;
    const mine = exchangeRate(amount, cur, toAmount, toAcc.currency);
    const fair = convert(amount, cur, toAcc.currency, rateOf);
    const cbr = fair ? exchangeRate(amount, cur, fair, toAcc.currency) : null;
    return { mine, cbr, diff: fair !== null ? toAmount - fair : null, pct: fair ? ((toAmount - fair) / fair) * 100 : null };
  }, [kind, amount, toAmount, toAcc, cur, rateOf]);

  async function save() {
    setError(null);
    if (!acc) return setError('Сначала заведите счёт.');
    if (!amount) return setError(`Введите сумму, например 350 или 12,40.`);
    if ((kind === 'transfer' || kind === 'exchange') && !toAcc) return setError('Выберите счёт, куда пришли деньги.');
    if (kind === 'exchange' && !toAmount) return setError('Сколько получили?');
    const body: Record<string, unknown> = {
      kind,
      day,
      account_id: acc.id,
      amount_minor: amount,
      to_account_id: kind === 'transfer' || kind === 'exchange' ? toAcc!.id : null,
      to_amount_minor: kind === 'exchange' ? toAmount : null,
      category_id: kind === 'expense' || kind === 'income' ? categoryId : null,
      payee: payee.trim() || null,
      note: note.trim() || null,
    };
    if ((kind === 'expense' || kind === 'income') && origOn && origAmount && origCur !== cur) {
      body.orig_amount_minor = origAmount;
      body.orig_currency = origCur;
    }
    if (!existing) body.source = draft.source ?? 'manual';
    setBusy(true);
    try {
      await (existing ? api(`money/ops/${existing.id}`, 'PATCH', body) : api('money/ops', 'POST', body));
      try {
        localStorage.setItem(LAST_ACCOUNT, acc.id);
      } catch {
        /* приватный режим — не запомним, не страшно */
      }
      await reload();
      toast(existing ? 'Сохранено' : 'Записано');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    try {
      await api(`money/ops/${existing.id}`, 'DELETE');
      await reload();
      toast('Удалено');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const sign = kind === 'income' ? '' : '−';
  return (
    <div className="sheet-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet m-sheet" role="dialog" aria-modal="true" aria-label={existing ? 'Операция' : 'Новая операция'}>
        <div className="sheet-head">
          <h2 className="display" style={{ margin: 0, fontSize: 'calc(18px * var(--fs))', flex: 1 }}>
            {existing ? 'Операция' : 'Новая операция'}
          </h2>
          {existing?.author && <span className="chip m-chip-blue">{existing.author}</span>}
          <button className="icon-btn bare" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </div>

        {kinds.length > 1 && (
          <div className="seg" role="group" aria-label="Тип операции" style={{ gridTemplateColumns: `repeat(${kinds.length}, 1fr)` }}>
            {kinds.map((k) => (
              <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        )}

        <div className="m-leg">
          <div className="m-leg-top">
            <label className="m-leg-label" htmlFor="op-amount">
              {kind === 'exchange' ? 'Отдал' : kind === 'transfer' ? 'Сколько' : 'Сумма'}
            </label>
            {shown('accounts') && usable.length > 1 ? (
              <select className="m-acc-select" aria-label="Счёт" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            ) : (
              <span className="muted m-small">{acc ? `${acc.name} · ${acc.currency}` : ''}</span>
            )}
          </div>
          <div className="m-amount-row">
            {kind !== 'transfer' && kind !== 'exchange' && <span className="m-amount-sign">{sign || '+'}</span>}
            <input id="op-amount" className="m-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus={!existing && !amountText} />
            <span className="m-amount-cur">{currency(cur).symbol ?? cur}</span>
          </div>
          {approx !== null && <div className="muted m-small">≈ {money(approx, base)} по курсу ЦБ</div>}
        </div>

        {(kind === 'transfer' || kind === 'exchange') && (
          <div className="m-leg">
            <div className="m-leg-top">
              <label className="m-leg-label" htmlFor="op-to">
                {kind === 'exchange' ? 'Получил' : 'Куда'}
              </label>
              {targets.length ? (
                <select id="op-to" className="m-acc-select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  {targets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted m-small">{kind === 'exchange' ? 'Нужен счёт в другой валюте' : 'Нужен ещё один счёт в той же валюте'}</span>
              )}
            </div>
            {kind === 'exchange' && toAcc && (
              <div className="m-amount-row">
                <input className="m-amount" inputMode="decimal" autoComplete="off" placeholder="0" aria-label="Сколько получил" value={toAmountText} onChange={(e) => setToAmountText(e.target.value)} />
                <span className="m-amount-cur">{currency(toAcc.currency).symbol ?? toAcc.currency}</span>
              </div>
            )}
          </div>
        )}

        {exchange && toAcc && (
          <div className="m-kv-box">
            {exchange.mine !== null && (
              <div className="m-kv">
                <span className="muted">Ваш курс</span>
                <span className="mono">
                  {exchange.mine >= 1 ? `${exchange.mine.toFixed(2).replace('.', ',')} ${toAcc.currency} за 1 ${cur}` : `${(1 / exchange.mine).toFixed(2).replace('.', ',')} ${cur} за 1 ${toAcc.currency}`}
                </span>
              </div>
            )}
            {exchange.cbr !== null && (
              <div className="m-kv">
                <span className="muted">По ЦБ</span>
                <span className="mono">
                  {exchange.cbr >= 1 ? `${exchange.cbr.toFixed(2).replace('.', ',')} ${toAcc.currency} за 1 ${cur}` : `${(1 / exchange.cbr).toFixed(2).replace('.', ',')} ${cur} за 1 ${toAcc.currency}`}
                </span>
              </div>
            )}
            {exchange.diff !== null && exchange.diff !== 0 && (
              <div className="m-kv">
                <span className="muted">{exchange.diff < 0 ? 'Потеряли на обмене' : 'Выгоднее ЦБ на'}</span>
                <span className="mono" style={{ color: exchange.diff < 0 ? 'var(--warm)' : 'var(--accent-ink)', fontWeight: 600 }}>
                  {money(exchange.diff, toAcc.currency, { sign: true })} · {Math.abs(exchange.pct ?? 0).toFixed(2).replace('.', ',')}%
                </span>
              </div>
            )}
          </div>
        )}

        {(kind === 'expense' || kind === 'income') && (
          <>
            <div className="m-field">
              <span className="label">Категория</span>
              <div className="m-chips">
                {foreignCat && (
                  <button type="button" className="chip" aria-pressed={categoryId === foreignCat.id} onClick={() => setCategoryId(foreignCat.id)}>
                    {foreignCat.name}
                  </button>
                )}
                {cats.map((c) => (
                  <button key={c.id} type="button" className="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="m-field">
              <span className="label">{kind === 'income' ? 'От кого' : 'Где или на что'}</span>
              <input className="field" value={payee} maxLength={120} onChange={(e) => setPayee(e.target.value)} placeholder={kind === 'income' ? 'Работа' : 'Пятёрочка, такси…'} />
            </label>
            {shown('currencies') && (
              <div className="m-field">
                <label className="m-check">
                  <input type="checkbox" checked={origOn} onChange={(e) => setOrigOn(e.target.checked)} />
                  Платил в другой валюте
                </label>
                {origOn && (
                  <div className="m-row">
                    <input className="field" inputMode="decimal" aria-label="Сумма в валюте покупки" placeholder="12,40" value={origText} onChange={(e) => setOrigText(e.target.value)} />
                    <select className="field" style={{ width: 110 }} aria-label="Валюта покупки" value={origCur} onChange={(e) => setOrigCur(e.target.value)}>
                      {[base, ...data.settings!.currencies].filter((c) => c !== cur).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {origHint !== null && origHint !== amount && (
                  <button type="button" className="btn btn-ghost m-hint-btn" onClick={() => setAmountText(editable(origHint, cur))}>
                    Подставить ≈ {money(origHint, cur)} по ЦБ
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div className="m-field">
          <span className="label">Дата</span>
          <div className="m-row">
            <button type="button" className="chip" aria-pressed={day === localDay()} onClick={() => setDay(localDay())}>
              Сегодня
            </button>
            <button type="button" className="chip" aria-pressed={day === localDay(addDays(new Date(), -1))} onClick={() => setDay(localDay(addDays(new Date(), -1)))}>
              Вчера
            </button>
            <input className="field" type="date" aria-label="Дата" value={day} max="2100-12-31" onChange={(e) => e.target.value && setDay(e.target.value)} style={{ flex: 1 }} />
          </div>
        </div>
        <label className="m-field">
          <span className="label">Заметка</span>
          <input className="field" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </label>

        {existing && existing.items_count > 0 && <p className="muted m-small" style={{ margin: 0 }}>В чеке позиций: {existing.items_count}</p>}
        {error && (
          <p className="m-error" role="alert">
            {error}
          </p>
        )}
        <div className="m-actions">
          {existing &&
            (confirmDelete ? (
              <button className="btn btn-danger" type="button" disabled={busy} onClick={remove}>
                Точно удалить
              </button>
            ) : (
              <button className="btn btn-danger-ghost" type="button" onClick={() => setConfirmDelete(true)}>
                Удалить
              </button>
            ))}
          <button className="btn btn-primary" type="button" disabled={busy} onClick={save} style={{ flex: 1 }}>
            {existing ? 'Сохранить' : 'Записать'}
          </button>
        </div>
      </section>
    </div>
  );
}
