'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { currency, formatMinor, money, parseAmount } from '@/lib/currencies';
import { ACCOUNT_KINDS, type AccountKind, type MoneyAccount } from '@/lib/money';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';

/** Счета: остатки, итог в основной валюте, добавить и поправить. */
export default function MoneyAccounts() {
  const { data, toBase, shown } = useMoney();
  const [edit, setEdit] = useState<MoneyAccount | 'new' | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const base = data.settings!.base_currency;
  const active = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const total = active.reduce((s, a) => s + (toBase(a.balance_minor, a.currency) ?? 0), 0);
  const canAdd = shown('accounts') || data.accounts.length === 0;

  return (
    <>
      <header className="m-head">
        <h1 className="display m-h1" style={{ flex: 1 }}>
          Счета
        </h1>
        {canAdd && (
          <button className="btn btn-primary" type="button" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            Счёт
          </button>
        )}
      </header>
      <main className="m-main">
        <section className="m-card" style={{ gap: 2 }}>
          <div className="muted m-small">Всего</div>
          <div className="display m-total">{money(total, base, { trim: true })}</div>
        </section>
        <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
          {active.map((a) => (
            <AccountRow key={a.id} a={a} onOpen={() => setEdit(a)} />
          ))}
        </div>
        {archived.length > 0 && (
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setShowArchive(!showArchive)}>
              {showArchive ? 'Скрыть архив' : `Архив · ${archived.length}`}
            </button>
            {showArchive && (
              <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
                {archived.map((a) => (
                  <AccountRow key={a.id} a={a} onOpen={() => setEdit(a)} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      {edit && <AccountSheet account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function AccountRow({ a, onOpen }: { a: MoneyAccount; onOpen: () => void }) {
  return (
    <button type="button" className="m-op" onClick={onOpen}>
      <span className="m-cur">{a.currency}</span>
      <span className="m-op-t">
        <b>{a.name}</b>
        <small>
          {ACCOUNT_KINDS.find((k) => k.id === a.kind)?.label}
          {a.shared && ' · семейный'}
          {a.author && ` · ${a.author}`}
        </small>
      </span>
      <span className="m-op-r">
        <span className="mono">{money(a.balance_minor, a.currency)}</span>
      </span>
    </button>
  );
}

function AccountSheet({ account, onClose }: { account: MoneyAccount | null; onClose: () => void }) {
  const { data, reload, toast, shown } = useMoney();
  const base = data.settings!.base_currency;
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'card');
  const [cur, setCur] = useState(account?.currency ?? base);
  const [opening, setOpening] = useState(account ? formatMinor(account.opening_minor, account.currency).replace(/ /g, '').replace('−', '-') : '');
  const [shared, setShared] = useState(account?.shared ?? false);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !!account && !account.mine;
  const currencies = [base, ...data.settings!.currencies];

  async function save() {
    setError(null);
    const neg = /^\s*[−-]/.test(opening);
    const n = opening.trim() ? parseAmount(opening.replace(/^\s*[−-]/, ''), cur) : 0;
    if (n === null) return setError('Не понял остаток — введите число, например 15 000.');
    if (!name.trim()) return setError('Как назвать счёт?');
    const body = { name: name.trim(), kind, currency: cur, opening_minor: neg ? -n : n, shared, archived };
    setBusy(true);
    try {
      await (account ? api(`money/accounts/${account.id}`, 'PATCH', body) : api('money/accounts', 'POST', body));
      await reload();
      toast(account ? 'Сохранено' : 'Счёт добавлен');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!account) return;
    setBusy(true);
    try {
      await api(`money/accounts/${account.id}`, 'DELETE');
      await reload();
      toast('Счёт удалён');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet m-sheet" role="dialog" aria-modal="true" aria-label={account ? 'Счёт' : 'Новый счёт'}>
        <div className="sheet-head">
          <h2 className="display" style={{ margin: 0, fontSize: 'calc(18px * var(--fs))', flex: 1 }}>
            {account ? account.name : 'Новый счёт'}
          </h2>
          <button className="icon-btn bare" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </div>
        {readOnly ? (
          <p className="muted" style={{ margin: 0 }}>
            Семейный счёт завёл {account!.author}. Менять его может только тот, кто завёл, а записывать на него операции — все в семье.
          </p>
        ) : (
          <>
            <label className="m-field">
              <span className="label">Название</span>
              <input className="field" value={name} maxLength={60} placeholder="Т-Банк, наличные, Wise…" onChange={(e) => setName(e.target.value)} autoFocus={!account} />
            </label>
            <label className="m-field">
              <span className="label">Тип</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                {ACCOUNT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {shown('currencies') && (
              <label className="m-field">
                <span className="label">Валюта</span>
                <select className="field" value={cur} onChange={(e) => setCur(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c} — {currency(c).name}
                    </option>
                  ))}
                </select>
                {account && <span className="muted m-small">Когда на счёте есть операции, валюту уже не поменять.</span>}
              </label>
            )}
            <label className="m-field">
              <span className="label">{account ? 'Начальный остаток' : 'Сколько на нём сейчас'}</span>
              <input className="field" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </label>
            {data.family && shown('family') && (
              <label className="m-check">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                Семейный — видят и пополняют все в семье
              </label>
            )}
            {account && (
              <label className="m-check">
                <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />В архиве — не показывать в списках
              </label>
            )}
            {error && (
              <p className="m-error" role="alert">
                {error}
              </p>
            )}
            <div className="m-actions">
              {account && (
                <button className="btn btn-danger-ghost" type="button" disabled={busy} onClick={remove}>
                  Удалить
                </button>
              )}
              <button className="btn btn-primary" type="button" disabled={busy} onClick={save} style={{ flex: 1 }}>
                {account ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
