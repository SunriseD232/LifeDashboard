'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { loadPhoto } from './photo';
import { Fixed } from './MoneyParts';

/** Строка выписки с подсказками сервера (src/server/moneyImport.ts). */
interface Row {
  day: string;
  amount_minor: number;
  currency: string | null;
  description: string;
  bank_category?: string;
  orig_amount_minor?: number;
  orig_currency?: string;
  key: string;
  kind: 'expense' | 'income' | 'transfer';
  payee: string;
  category_id: string | null;
  to_account_id: string | null;
  transfer_hint: boolean;
}

interface Result {
  format: string;
  bank: string | null;
  currency: string | null;
  account_ref: string | null;
  signature: string | null;
  mapping: unknown;
  merged: number;
  account_id: string | null;
  rows: Row[];
}

type Check = { status: 'new' } | { status: 'exists' } | { status: 'link'; op_id: string; title: string; day: string; source: string };

type Phase = 'pick' | 'reading' | 'review' | 'done';

const FILE_TYPES = '.csv,.txt,.xlsx,.pdf,.ofx,.qfx,.qif,.xml,.sta,.940,.mt940,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PAGE = 60;

const dayTitle = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });

function fileBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Не получилось прочитать файл.'));
    r.readAsDataURL(f);
  });
}

/**
 * Импорт выписки: файл банка или скриншоты → проверить → записать. Повторы
 * (уже импортированное и записанное вручную) находит сервер; категории и
 * понятные названия подсказывают прошлые импорты и ИИ.
 */
export default function MoneyImport() {
  const { data, reload, toast } = useMoney();
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [on, setOn] = useState<boolean[]>([]);
  const [accountId, setAccountId] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; linked: number } | null>(null);
  const [slow, setSlow] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const mine = data.accounts.filter((a) => !a.archived && a.mine);
  const acc = data.accounts.find((a) => a.id === accountId);
  const cats = data.categories;

  async function start(body: Record<string, unknown>) {
    setError(null);
    setPhase('reading');
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 15000);
    try {
      const { job } = await api<{ job: string }>('money/import/start', 'POST', { ...body, today: localDay() });
      // Ждём фоновую задачу: длинный PDF ИИ читает минуту-две.
      for (let i = 0; i < 150 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, i < 5 ? 800 : 2000));
        const j = await api<{ status: string; result?: Result; error?: string }>(`money/import/job?id=${job}`);
        if (j.status === 'error') throw new Error(j.error);
        if (j.status === 'done' && j.result) {
          const r = j.result;
          setRes(r);
          setRows(r.rows);
          setShown(PAGE);
          const pick = r.account_id ?? mine.find((a) => a.currency === r.currency)?.id ?? mine[0]?.id ?? '';
          setAccountId(pick);
          setPhase('review');
          return;
        }
      }
      if (alive.current) throw new Error('Выписка читается слишком долго. Попробуйте файл покороче или CSV.');
    } catch (e) {
      setError((e as Error).message);
      setPhase('pick');
    } finally {
      clearTimeout(slowTimer);
    }
  }

  // Повторы зависят от счёта: проверяем при выборе счёта.
  useEffect(() => {
    if (phase !== 'review' || !accountId || !rows.length) return;
    let stop = false;
    api<{ rows: Check[] }>('money/import/check', 'POST', { account_id: accountId, rows: rows.map((r) => ({ key: r.key, day: r.day, amount_minor: r.amount_minor })) })
      .then((c) => {
        if (stop) return;
        setChecks(c.rows);
        const accCur = data.accounts.find((a) => a.id === accountId)?.currency;
        setOn(rows.map((r, i) => c.rows[i]?.status !== 'exists' && (!r.currency || r.currency === accCur)));
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      stop = true;
    };
  }, [phase, accountId, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const visible = useMemo(() => rows.map((r, i) => ({ r, i })).filter(({ i }) => checks[i]?.status !== 'exists'), [rows, checks]);
  const exists = checks.filter((c) => c.status === 'exists').length;
  const links = checks.filter((c, i) => c.status === 'link' && on[i]).length;
  const count = on.filter(Boolean).length;
  const foreignCur = res?.currency && acc && res.currency !== acc.currency ? res.currency : null;

  async function commit() {
    if (!acc || !res) return;
    setBusy(true);
    setError(null);
    try {
      const body = rows
        .map((r, i) => ({ r, i }))
        .filter(({ i }) => on[i])
        .map(({ r, i }) => {
          const c = checks[i];
          if (c?.status === 'link') return { key: r.key, action: 'link', link_id: c.op_id };
          const desc = r.description.slice(0, 2000);
          return {
            key: r.key,
            action: 'new',
            kind: r.kind === 'transfer' && r.to_account_id ? 'transfer' : r.amount_minor < 0 ? 'expense' : 'income',
            day: r.day,
            amount_minor: r.amount_minor,
            category_id: r.kind === 'transfer' ? null : r.category_id,
            payee: (r.payee || desc).slice(0, 120) || null,
            note: r.payee && desc ? desc : null,
            to_account_id: r.kind === 'transfer' ? r.to_account_id : null,
            ...(r.orig_currency && r.orig_currency !== acc.currency ? { orig_amount_minor: r.orig_amount_minor, orig_currency: r.orig_currency } : {}),
          };
        });
      const r = await api<{ added: number; linked: number }>('money/import/commit', 'POST', { account_id: acc.id, rows: body, signature: res.signature, mapping: res.mapping, bank: res.bank });
      await reload();
      setDone(r);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputs = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={FILE_TYPES}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 8_000_000) return setError('Файл больше 8 МБ — выгрузите выписку за меньший период.');
          start({ kind: 'file', name: f.name, data: await fileBase64(f) });
        }}
      />
      <input
        ref={shotInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          if (files.length > 10) return setError('Не больше 10 скриншотов за раз.');
          try {
            const images = await Promise.all(files.map((f) => loadPhoto(f, 1600).then((p) => p.dataUrl)));
            start({ kind: 'screens', images });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    </>
  );

  return (
    <>
      <header className="m-head">
        <Link className="icon-btn bare" href="/money/accounts" aria-label="Назад">
          <Icon name="back" />
        </Link>
        <h1 className="display m-h1" style={{ flex: 1 }}>
          {phase === 'review' ? 'Проверьте импорт' : 'Импорт'}
        </h1>
      </header>
      <main className="m-main m-import">
        {inputs}
        {error && (
          <p className="m-error" role="alert">
            {error}
          </p>
        )}

        {phase === 'pick' && (
          <>
            <button type="button" className="m-card m-pick" onClick={() => fileInput.current?.click()}>
              <span className="m-op-ic">
                <Icon name="download" />
              </span>
              <span className="m-op-t">
                <b>Файл выписки</b>
                <small>CSV, Excel, PDF, OFX, QIF, CAMT.053, MT940</small>
              </span>
            </button>
            <button type="button" className="m-card m-pick" onClick={() => shotInput.current?.click()}>
              <span className="m-op-ic">
                <Icon name="camera" />
              </span>
              <span className="m-op-t">
                <b>Скриншоты</b>
                <small>Список операций из приложения банка, до 10 снимков</small>
              </span>
            </button>
            <details className="m-card m-help">
              <summary>Где взять выписку</summary>
              <p>
                В приложении или интернет-банке найдите «Выписка» или «Statement» и выберите период. Лучше всего — <b>CSV</b>, <b>Excel</b>, <b>OFX</b> или <b>CAMT.053</b>{' '}
                (так выгружают многие банки Европы): они читаются точно. <b>PDF</b> тоже подойдёт — его прочитает ИИ.
              </p>
              <p>Выгрузки нет — сделайте скриншоты списка операций. Перекрываются — не страшно: одинаковые строки склеятся.</p>
              <p>Один и тот же период можно загружать снова: уже импортированное не задвоится, а записанное вручную — объединится.</p>
            </details>
          </>
        )}

        {phase === 'reading' && (
          <div className="m-card m-reading" aria-busy="true" aria-live="polite">
            <span className="m-spinner" aria-hidden="true" />
            <span>{slow ? 'Длинная выписка — ИИ читает построчно, это может занять минуту-две…' : 'Читаю выписку…'}</span>
          </div>
        )}

        {phase === 'review' && res && (
          <>
            <div className="m-card" style={{ gap: 10 }}>
              <div className="m-badges">
                <span className="chip m-chip-ai">{res.bank ? `${res.bank} · ${res.format}` : res.format}</span>
                <span className="chip">{rows.length} строк</span>
                {res.merged > 0 && <span className="chip">{res.merged} повторов склеено</span>}
                {exists > 0 && <span className="chip">{exists} уже есть</span>}
                {links > 0 && <span className="chip m-chip-ok">{links} объединю с записанными</span>}
              </div>
              <label className="m-field">
                <span className="label">На какой счёт</span>
                <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {mine.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </select>
              </label>
              {foreignCur && <p className="m-error" style={{ margin: 0 }}>Выписка в {foreignCur}, а счёт в {acc!.currency}. Выберите счёт в {foreignCur} или заведите его.</p>}
            </div>

            {!visible.length && checks.length > 0 && <p className="muted" style={{ textAlign: 'center', margin: '12px 0' }}>Всё из этой выписки уже есть на счёте.</p>}
            <div className="m-card" style={{ gap: 0, padding: '0 12px' }} hidden={!visible.length}>
              {visible.slice(0, shown).map(({ r, i }, n) => {
                const prev = visible[n - 1]?.r.day;
                const c = checks[i];
                const otherCur = r.currency && acc && r.currency !== acc.currency;
                const sameCurAccounts = mine.filter((a) => a.id !== accountId && a.currency === acc?.currency);
                return (
                  <div key={r.key}>
                    {prev !== r.day && <div className="m-day">{dayTitle(r.day)}</div>}
                    <div className={`m-irow${on[i] ? '' : ' off'}`}>
                      <input type="checkbox" className="m-icheck" aria-label={`Импортировать: ${r.payee || r.description}`} checked={!!on[i]} onChange={(e) => setOn((l) => l.map((x, j) => (j === i ? e.target.checked : x)))} />
                      <div className="m-op-t">
                        <b>{r.payee || r.description || 'Без описания'}</b>
                        {r.payee && r.description && <small>{r.description}</small>}
                        {c?.status === 'link' ? (
                          <small className="m-note-ok">
                            уже внесено{c.source === 'photo' ? ' с чеком' : ''}: «{c.title}» · объединю
                          </small>
                        ) : otherCur ? (
                          <small className="m-note-warn">в {r.currency} — это другой счёт</small>
                        ) : r.kind === 'transfer' ? (
                          <div className="m-item-meta">
                            <small>{r.amount_minor < 0 ? 'перевод на' : 'перевод с'}</small>
                            <select className="m-cat-select" aria-label="Свой счёт" value={r.to_account_id ?? ''} onChange={(e) => setRow(i, e.target.value ? { to_account_id: e.target.value } : { kind: r.amount_minor < 0 ? 'expense' : 'income', to_account_id: null })}>
                              <option value="">не перевод</option>
                              {sameCurAccounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="m-item-meta">
                            <select className="m-cat-select" aria-label="Категория" value={r.category_id ?? ''} onChange={(e) => setRow(i, { category_id: e.target.value || null })}>
                              <option value="">{r.bank_category ? `Без категории (банк: ${r.bank_category})` : 'Без категории'}</option>
                              {cats
                                .filter((x) => x.kind === (r.amount_minor < 0 ? 'expense' : 'income'))
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                  </option>
                                ))}
                            </select>
                            {r.transfer_hint && !sameCurAccounts.length && <small className="m-note-warn">похоже на перевод между своими счетами</small>}
                            {sameCurAccounts.length > 0 && (
                              <select className={`m-cat-select${r.transfer_hint ? ' m-cat-warn' : ''}`} aria-label="Перевод на свой счёт" value="" onChange={(e) => e.target.value && setRow(i, { kind: 'transfer', to_account_id: e.target.value })}>
                                <option value="">{r.transfer_hint ? 'похоже на перевод себе…' : 'это перевод себе?'}</option>
                                {sameCurAccounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {r.amount_minor < 0 ? 'на' : 'с'} {a.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                      <span className={`mono${r.amount_minor > 0 ? ' m-pos' : ''}`}>{money(r.amount_minor, r.currency ?? acc?.currency ?? 'RUB', { sign: true })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {visible.length > shown && (
              <button className="btn btn-ghost" type="button" onClick={() => setShown((n) => n + PAGE)}>
                Ещё {visible.length - shown} строк
              </button>
            )}
            <Fixed>
            <div className="m-import-go">
              <button className="btn btn-ghost" type="button" onClick={() => setPhase('pick')} disabled={busy}>
                Другой файл
              </button>
              <button className="btn btn-primary" type="button" style={{ flex: 1 }} disabled={busy || !count || !acc} onClick={commit}>
                {count ? `Импортировать ${count}` : 'Нечего импортировать'}
              </button>
            </div>
            </Fixed>
          </>
        )}

        {phase === 'done' && done && (
          <div className="m-card" style={{ gap: 12 }}>
            <h2 className="display" style={{ margin: 0 }}>
              Готово
            </h2>
            <p style={{ margin: 0 }}>
              Добавлено операций: {done.added}
              {done.linked ? `, объединено с записанными: ${done.linked}` : ''}.
            </p>
            <div className="m-row">
              <Link className="btn btn-primary" href="/money/ops" style={{ flex: 1 }} onClick={() => toast('Импорт сохранён')}>
                К операциям
              </Link>
              <button className="btn btn-ghost" type="button" onClick={() => (setPhase('pick'), setRes(null), setRows([]), setChecks([]))}>
                Ещё выписку
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
