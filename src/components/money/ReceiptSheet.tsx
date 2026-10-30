'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { currency, formatMinor, money, parseAmount } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import { convert, type MoneyOp } from '@/lib/money';
import { mainCategory, parseFiscalQr, type DraftItem, type FiscalQr, type ReceiptDraft } from '@/lib/moneyAi';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { findQr, loadPhoto } from './photo';

const editable = (minor: number | null | undefined, code: string) => (minor ? formatMinor(minor, code).replace(/ /g, '') : '');
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

type Phase = 'pick' | 'reading' | 'edit' | 'error';

/**
 * Чек с позициями. Новый — с фото: ИИ читает магазин, дату, итог и позиции,
 * QR (если он есть, как на российских чеках) проверяет сумму и дату. Для
 * записанной операции — её позиции: посмотреть, поправить, добавить с фото.
 */
export default function ReceiptSheet({ file, op, onClose }: { file?: File; op?: MoneyOp; onClose: () => void }) {
  const { data, reload, toast, rateOf, reveal } = useMoney();
  const base = data.settings!.base_currency;
  const [phase, setPhase] = useState<Phase>(file ? 'reading' : op?.items_count ? 'reading' : 'pick');
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<FiscalQr | null>(null);
  const [payee, setPayee] = useState(op?.payee ?? '');
  const [day, setDay] = useState(op?.day ?? localDay());
  const [time, setTime] = useState<string | null>(null);
  const [cur, setCur] = useState(op ? (op.orig_currency ?? op.currency) : base);
  const [totalText, setTotalText] = useState(op ? editable(op.orig_amount_minor ?? op.amount_minor, op.orig_currency ?? op.currency) : '');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [accountId, setAccountId] = useState(op?.account_id ?? '');
  const [chargedText, setChargedText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const live = data.accounts.filter((a) => !a.archived);
  const acc = data.accounts.find((a) => a.id === accountId);
  const total = parseAmount(totalText, cur);
  const sum = items.reduce((s, i) => s + i.total_minor, 0);
  const foreign = acc && acc.currency !== cur;
  const charged = foreign ? parseAmount(chargedText, acc.currency) : total;
  const cats = data.categories.filter((c) => c.kind === 'expense');

  function apply(r: ReceiptDraft) {
    setPayee(r.payee);
    setDay(r.day);
    setTime(r.time);
    setCur(r.currency);
    setTotalText(editable(r.total_minor, r.currency));
    setItems(r.items);
    // Счёт: в валюте чека, иначе последний, иначе первый.
    let last: string | null = null;
    try {
      last = localStorage.getItem('money:lastAccount');
    } catch {
      /* приватный режим */
    }
    const pick = live.find((a) => a.currency === r.currency) ?? live.find((a) => a.id === last) ?? live[0];
    if (pick) {
      setAccountId(pick.id);
      if (pick.currency !== r.currency) setChargedText(editable(convert(r.total_minor, r.currency, pick.currency, rateOf), pick.currency));
    }
  }

  async function read(f: File) {
    setPhase('reading');
    setError(null);
    try {
      const photo = await loadPhoto(f);
      const req = api<{ receipt: ReceiptDraft }>('money/ai/receipt', 'POST', { image: photo.dataUrl, today: localDay() });
      // QR ищем, пока ИИ читает: на телефоне это доли секунды.
      const code = await new Promise<string | null>((r) => setTimeout(() => r(findQr(photo.canvas, (t) => !!parseFiscalQr(t))), 0));
      const fiscal = code ? parseFiscalQr(code) : null;
      setQr(fiscal);
      try {
        const { receipt } = await req;
        if (op) {
          // К записанной операции — только позиции.
          setItems(receipt.items);
          setCur(receipt.currency);
        } else apply(receipt);
      } catch (e) {
        // ИИ не прочитал, а QR есть — хотя бы сумма и дата.
        if (!fiscal || op) throw e;
        apply({ payee: '', day: fiscal.day, time: fiscal.time, currency: 'RUB', total_minor: fiscal.total_minor, items: [] });
        toast('Позиции не прочитались — сумму и дату взял из QR');
      }
      setPhase('edit');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  useEffect(() => {
    if (file) read(file);
    else if (op?.items_count) {
      api<{ items: DraftItem[] }>(`money/ops/${op.id}`)
        .then((r) => {
          setItems(r.items);
          setPhase('edit');
        })
        .catch((e) => {
          setError((e as Error).message);
          setPhase('error');
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Трата из банка без чека с той же суммой и близкой датой — предложим приложить позиции к ней.
  const match = useMemo(() => {
    if (op || !charged || !acc) return null;
    const t = new Date(`${day}T12:00:00`).getTime();
    return data.ops.find((o) => o.kind === 'expense' && !o.items_count && o.mine && o.account_id === acc.id && o.amount_minor === charged && Math.abs(new Date(`${o.day}T12:00:00`).getTime() - t) <= 3 * 864e5) ?? null;
  }, [op, charged, acc, day, data.ops]);

  const qrCheck = qr && cur === 'RUB' && !op ? { sum: qr.total_minor === total, day: qr.day === day } : null;
  const byCat = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const i of items) m.set(i.category_id, (m.get(i.category_id) ?? 0) + i.total_minor);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const setItem = (i: number, patch: Partial<DraftItem>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save(attachTo?: MoneyOp) {
    setError(null);
    const target = op ?? attachTo;
    const list = items.map((i) => ({ ...i, name: i.name.trim() || 'Без названия' }));
    setBusy(true);
    try {
      if (target) {
        await api(`money/ops/${target.id}`, 'PATCH', { only_items: true, items: list, category_id: mainCategory(list) });
      } else {
        if (!acc) throw new Error('Сначала заведите счёт.');
        if (!total) throw new Error('Введите итог чека.');
        if (!charged) throw new Error(`Сколько списали со счёта в ${acc.currency}?`);
        const body = {
          kind: 'expense',
          day,
          account_id: acc.id,
          amount_minor: charged,
          category_id: mainCategory(list),
          payee: payee.trim() || null,
          note: time ? `Чек в ${time}` : null,
          source: 'photo',
          items: list,
          ...(foreign ? { orig_amount_minor: total, orig_currency: cur } : {}),
        };
        try {
          await api('money/ops', 'POST', body);
        } catch (e) {
          // Такой чек уже есть — записать второй раз, только если человек так решил.
          if ((e as { status?: number }).status !== 409 || !confirm(`${(e as Error).message} Записать ещё раз?`)) throw e;
          await api('money/ops', 'POST', { ...body, force: true });
        }
        try {
          localStorage.setItem('money:lastAccount', acc.id);
        } catch {
          /* приватный режим */
        }
      }
      await reload();
      const where = target ? null : reveal(day);
      toast(target ? 'Позиции сохранены' : where ? `Чек от ${shortDay(day)} записан — показываю ${where}` : 'Чек записан');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) read(f);
      }}
    />
  );

  return (
    <div className="sheet-scrim" onClick={(e) => e.target === e.currentTarget && !busy && phase !== 'reading' && onClose()}>
      <section className="sheet m-sheet" role="dialog" aria-modal="true" aria-label="Чек">
        {picker}
        <div className="sheet-head">
          <h2 className="display" style={{ margin: 0, fontSize: 'calc(18px * var(--fs))', flex: 1 }}>
            {op ? `Чек: ${op.payee || op.category_name || 'трата'}` : 'Чек'}
          </h2>
          <button className="icon-btn bare" type="button" onClick={onClose} aria-label="Закрыть" disabled={phase === 'reading'}>
            <Icon name="x" />
          </button>
        </div>

        {phase === 'pick' && (
          <div className="m-card" style={{ gap: 12, alignItems: 'flex-start' }}>
            <p style={{ margin: 0 }}>Сфотографируйте чек целиком — позиции разложатся по категориям.</p>
            <button className="btn btn-primary" type="button" onClick={() => input.current?.click()}>
              <Icon name="camera" size={18} />
              Фото чека
            </button>
          </div>
        )}

        {phase === 'reading' && (
          <div className="m-card m-reading" aria-busy="true" aria-live="polite">
            <span className="m-spinner" aria-hidden="true" />
            <span>{file ? 'Читаю чек — обычно 10–20 секунд…' : 'Загружаю позиции…'}</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="m-card" style={{ gap: 12, alignItems: 'flex-start' }}>
            <p className="m-error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
            <button className="btn btn-ghost" type="button" onClick={() => input.current?.click()}>
              <Icon name="camera" size={18} />
              Другое фото
            </button>
          </div>
        )}

        {phase === 'edit' && (
          <>
            {!op && (
              <div className="m-card" style={{ gap: 10 }}>
                <div className="m-row">
                  <input className="field" aria-label="Магазин" placeholder="Магазин" value={payee} maxLength={120} onChange={(e) => setPayee(e.target.value)} style={{ flex: 1 }} />
                  <input className="field" type="date" aria-label="Дата" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 150 }} />
                </div>
                <div className="m-amount-row">
                  <span className="m-amount-sign">−</span>
                  <input className="m-amount" inputMode="decimal" aria-label="Итог чека" value={totalText} onChange={(e) => setTotalText(e.target.value)} />
                  <span className="m-amount-cur">{currency(cur).symbol ?? cur}</span>
                </div>
                {live.length > 1 && (
                  <select
                    className="m-acc-select"
                    aria-label="Счёт"
                    value={accountId}
                    onChange={(e) => {
                      const a = data.accounts.find((x) => x.id === e.target.value);
                      setAccountId(e.target.value);
                      if (a && a.currency !== cur && total) setChargedText(editable(convert(total, cur, a.currency, rateOf), a.currency));
                    }}
                  >
                    {live.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.currency}
                      </option>
                    ))}
                  </select>
                )}
                {foreign && acc && (
                  <label className="m-field">
                    <span className="label">Списали со счёта, {acc.currency}</span>
                    <input className="field" inputMode="decimal" value={chargedText} onChange={(e) => setChargedText(e.target.value)} />
                  </label>
                )}
                <div className="m-badges">
                  {qrCheck &&
                    (qrCheck.sum && qrCheck.day ? (
                      <span className="chip m-chip-ok">
                        <Icon name="check" size={14} /> QR: сумма и дата совпали
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="chip m-chip-warn"
                        onClick={() => {
                          setTotalText(editable(qr!.total_minor, 'RUB'));
                          setDay(qr!.day);
                        }}
                      >
                        По QR: {money(qr!.total_minor, 'RUB')}, {shortDay(qr!.day)} — подставить
                      </button>
                    ))}
                  {qr && qr.type === 2 && <span className="chip m-chip-warn">Это чек возврата</span>}
                  {items.length > 0 && total !== null && (
                    <span className={`chip ${sum === total ? 'm-chip-ok' : 'm-chip-warn'}`}>
                      {sum === total ? 'позиции = итог' : `позиции ${sum > total ? 'больше' : 'меньше'} итога на ${money(Math.abs(sum - total), cur)}`}
                    </span>
                  )}
                </div>
              </div>
            )}

            <h3 className="group-title" style={{ margin: 0 }}>
              {items.length ? `${items.length} поз.` : 'Позиций нет'}
            </h3>
            {items.length > 0 && (
              <div className="m-card" style={{ gap: 0, padding: '0 12px' }}>
                {items.map((it, i) =>
                  open === i ? (
                    <div key={i} className="m-item m-item-edit">
                      <input className="field" aria-label="Название" value={it.name} maxLength={200} onChange={(e) => setItem(i, { name: e.target.value })} />
                      <div className="m-row">
                        <input
                          className="field"
                          inputMode="decimal"
                          aria-label="Количество"
                          defaultValue={String(it.qty).replace('.', ',')}
                          onChange={(e) => {
                            const q = Number(e.target.value.replace(',', '.'));
                            if (q > 0) setItem(i, { qty: q });
                          }}
                          style={{ width: 80 }}
                        />
                        <input
                          className="field"
                          inputMode="decimal"
                          aria-label="Сумма позиции"
                          defaultValue={editable(it.total_minor, cur)}
                          onChange={(e) => {
                            const n = parseAmount(e.target.value, cur);
                            if (n) setItem(i, { total_minor: n });
                          }}
                          style={{ flex: 1 }}
                        />
                      </div>
                      <div className="m-row">
                        <button className="btn btn-danger-ghost" type="button" onClick={() => (setItems((l) => l.filter((_, j) => j !== i)), setOpen(null))}>
                          Удалить
                        </button>
                        <button className="btn btn-ghost" type="button" style={{ flex: 1 }} onClick={() => setOpen(null)}>
                          Готово
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="m-item">
                      <div className="m-op-t">
                        <button type="button" className="m-item-name" onClick={() => setOpen(i)}>
                          {it.name}
                        </button>
                        <div className="m-item-meta">
                          {(it.qty !== 1 || it.unit) && (
                            <small className="mono muted">
                              {String(it.qty).replace('.', ',')}
                              {it.unit ? ` ${it.unit}` : ''}
                              {it.price_minor ? ` × ${formatMinor(it.price_minor, cur)}` : ''}
                            </small>
                          )}
                          <select className="m-cat-select" aria-label={`Категория: ${it.name}`} value={it.category_id ?? ''} onChange={(e) => setItem(i, { category_id: e.target.value || null })}>
                            <option value="">Без категории</option>
                            {cats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <span className="mono">{formatMinor(it.total_minor, cur)}</span>
                    </div>
                  ),
                )}
              </div>
            )}
            <div className="m-row">
              <button
                className="btn btn-ghost"
                type="button"
                style={{ flex: 1 }}
                onClick={() => {
                  setItems((l) => [...l, { name: '', qty: 1, unit: null, price_minor: null, total_minor: 100, category_id: mainCategory(l) }]);
                  setOpen(items.length);
                }}
              >
                <Icon name="plus" size={18} /> Позиция
              </button>
              {op && (
                <button className="btn btn-ghost" type="button" style={{ flex: 1 }} onClick={() => input.current?.click()}>
                  <Icon name="camera" size={18} /> {items.length ? 'Заново с фото' : 'С фото'}
                </button>
              )}
            </div>

            {byCat.length > 1 && (
              <div className="m-kv-box">
                {byCat.map(([id, n]) => (
                  <div key={id ?? '-'} className="m-kv">
                    <span className="muted">{cats.find((c) => c.id === id)?.name ?? 'Без категории'}</span>
                    <span className="mono">{money(n, cur)}</span>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <p className="m-error" role="alert">
                {error}
              </p>
            )}
            {match && (
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => save(match)}>
                Приложить к трате «{match.payee || match.category_name || 'без названия'}», {shortDay(match.day)}
              </button>
            )}
            <div className="m-actions">
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => save()} style={{ flex: 1 }}>
                {op ? 'Сохранить позиции' : match ? 'Записать новой тратой' : 'Записать'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
