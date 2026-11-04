'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { money } from '@/lib/currencies';
import { addDays, localDay } from '@/lib/dates';
import { quickParse, type MoneyAccount, type MoneyFrequent, type MoneyOp, type OpItemBrief } from '@/lib/money';
import { looksLikeQuestion, needsAi, type MoneyDraft } from '@/lib/moneyAi';
import { Icon } from '../icons';
import { useSheet } from '../useModalFocus';
import { useMoney } from './MoneyShell';
import { showDrafts } from './VoiceSheet';

/**
 * Строка быстрого ввода: «кофе 350», «такси 12 € вчера» — разбираем сами и
 * открываем окно операции уже заполненным; длинное или с несколькими
 * суммами («продукты 1200 и кофе 350») — разбирает ИИ. Рядом — голос и
 * фото чека, если включены.
 */
/**
 * Закреплённое у края окна (строка ввода, кнопки импорта). Рисуем прямо в
 * body: экран при переходе едет через transform, а fixed внутри такого
 * родителя считается от него — строка сначала оказывалась сверху и падала вниз.
 */
export function Fixed({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}

export function QuickBar() {
  const { data, openOp, open, aiOn, toast, reload } = useMoney();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const photo = useRef<HTMLInputElement>(null);

  function local(t: string) {
    const p = quickParse(t, data.settings!.base_currency);
    const low = p.title.toLowerCase();
    const cat = data.categories.find((c) => c.kind === 'expense' && c.name.toLowerCase() === low);
    const past = data.ops.find((o) => o.kind === 'expense' && o.payee?.toLowerCase() === low);
    openOp({
      kind: 'expense',
      amount_minor: p.amount_minor,
      currency: p.currency,
      payee: cat ? '' : p.title,
      day: localDay(addDays(new Date(), -p.days_ago)),
      category_id: cat?.id ?? past?.category_id ?? null,
      account_id: p.currency ? undefined : past?.account_id,
      source: 'text',
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return openOp(null);
    const p = quickParse(t, data.settings!.base_currency);
    const asking = looksLikeQuestion(t);
    // Простая запись («кофе 350») — сразу, без ИИ и без сети.
    if (!aiOn() || (!asking && !needsAi(t, p.amount_minor !== null))) {
      local(t);
      setText('');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!asking && p.amount_minor !== null) {
        local(t);
        setText('');
      } else toast('Без сети вопрос не отправится. Траты записывать можно — они уйдут, когда появится связь.');
      return;
    }
    setBusy(true);
    try {
      // Одна просьба к ИИ: он сам решает — записать или ответить.
      const res = await api<{ result: 'payment'; ops: MoneyDraft[] } | { result: 'question'; answer: string; search: string | null }>('money/ai/say', 'POST', { text: t, today: localDay() });
      if (res.result === 'question') open({ type: 'answer', q: t, a: res.answer, search: res.search });
      else showDrafts(open, res.ops, t);
      setText('');
    } catch (err) {
      // ИИ не ответил — простой разбор лучше, чем ничего.
      if (!asking && p.amount_minor !== null) {
        local(t);
        setText('');
      } else toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Частая трата одним нажатием: сразу записываем, в сообщении — «Отменить». */
  async function quick(f: MoneyFrequent) {
    setBusy(true);
    try {
      const res = await api<{ id?: string; queued?: boolean }>('money/ops', 'POST', {
        kind: 'expense',
        day: localDay(),
        account_id: f.account_id,
        amount_minor: f.amount_minor,
        category_id: f.category_id,
        payee: f.payee,
        source: 'text',
      });
      await reload();
      const what = `${f.payee} ${money(f.amount_minor, f.currency, { trim: true })}`;
      if (res?.queued) toast(`Нет сети — «${what}» отправлю, когда появится`);
      else
        toast(`Записано: ${what}`, res?.id
          ? {
              label: 'Отменить',
              run: async () => {
                await api(`money/ops/${res.id}`, 'DELETE');
                await reload();
                toast('Отменено');
              },
            }
          : undefined);
      (document.activeElement as HTMLElement | null)?.blur();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const typed = !!text.trim();
  const frequent = (data.frequent ?? []).filter((f) => data.accounts.some((a) => a.id === f.account_id && !a.archived));
  return (
    <Fixed>
    <form className="m-qbar" onSubmit={submit} aria-label="Быстрый ввод" aria-busy={busy} onFocus={() => setFocused(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFocused(false)}>
      {focused && !typed && frequent.length > 0 && (
        <div className="m-qchips" role="group" aria-label="Частые траты — записать одним нажатием">
          {frequent.map((f) => (
            <button key={`${f.payee}|${f.amount_minor}|${f.account_id}`} type="button" className="chip" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => quick(f)}>
              {f.payee} <span className="mono">{money(f.amount_minor, f.currency, { trim: true })}</span>
            </button>
          ))}
        </div>
      )}
      <label htmlFor="m-quick" className="sr-only">
        {aiOn() ? 'Записать трату или спросить о тратах' : 'Что потратили'}
      </label>
      <input id="m-quick" className="field" type="text" enterKeyHint="done" autoComplete="off" placeholder={aiOn() ? 'Кофе 350 или вопрос о тратах' : 'Кофе 350, такси 12 € вчера…'} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      {!typed && aiOn('receipts') && (
        <>
          <input
            ref={photo}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) open({ type: 'receipt', file: f });
            }}
          />
          <button className="icon-btn bare" type="button" aria-label="Фото чека" onClick={() => photo.current?.click()}>
            <Icon name="camera" size={22} />
          </button>
        </>
      )}
      {!typed && aiOn('voice') && (
        <button className="icon-btn bare" type="button" aria-label="Сказать голосом" onClick={() => open({ type: 'voice' })}>
          <Icon name="mic" size={22} />
        </button>
      )}
      <button className="icon-btn m-qbar-go" type="submit" disabled={busy} aria-label={typed ? 'Отправить' : 'Новая операция'}>
        {busy ? <span className="m-spinner m-spinner-light" aria-hidden="true" /> : <Icon name={typed ? 'arrow' : 'plus'} size={22} />}
      </button>
    </form>
    </Fixed>
  );
}

const KIND_ICON: Record<MoneyOp['kind'], string> = { expense: 'cart', income: 'plus', transfer: 'arrow', exchange: 'exchange' };
const KIND_LABEL: Record<MoneyOp['kind'], string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', exchange: 'Обмен' };

/** Одна операция в списке: что, откуда, сколько. Нажатие — открыть. */
export function OpRow({ op, accounts, found }: { op: MoneyOp; accounts: MoneyAccount[]; found?: OpItemBrief[] }) {
  const { openOp } = useMoney();
  const from = accounts.find((a) => a.id === op.account_id);
  const to = accounts.find((a) => a.id === op.to_account_id);
  const title = op.payee || (op.kind === 'expense' || op.kind === 'income' ? op.category_name : null) || KIND_LABEL[op.kind];
  const meta = [
    op.kind === 'transfer' || op.kind === 'exchange' ? `${from?.name ?? '?'} → ${to?.name ?? '?'}` : op.payee ? op.category_name : null,
    op.kind === 'transfer' || op.kind === 'exchange' ? null : from?.name,
    op.items_count ? `чек, ${op.items_count} поз.` : null,
    op.debt_id ? 'долг' : op.source === 'sms' ? 'из SMS' : op.source === 'recurring' ? 'регулярный' : null,
    op.author,
  ].filter(Boolean);
  return (
    <button type="button" className="m-op" onClick={() => openOp(op)}>
      <span className="m-op-ic">
        <Icon name={op.debt_id ? 'users' : op.items_count ? 'receipt' : KIND_ICON[op.kind]} />
      </span>
      <span className="m-op-t">
        <b>{title}</b>
        {meta.length > 0 && <small>{meta.join(' · ')}</small>}
        {found?.map((i, k) => (
          <small key={k} className="m-op-hit">
            {i.name} · <span className="mono">{money(i.total_minor, op.orig_currency ?? op.currency)}</span>
          </small>
        ))}
      </span>
      <span className="m-op-r">
        {op.kind === 'exchange' ? (
          <>
            <span className="mono">{money(-op.amount_minor, op.currency)}</span>
            <small className="mono m-pos">{money(op.to_amount_minor ?? 0, op.to_currency ?? '', { sign: true })}</small>
          </>
        ) : (
          <>
            <span className={`mono${op.kind === 'income' ? ' m-pos' : ''}`}>
              {op.kind === 'transfer' ? money(op.amount_minor, op.currency) : money(op.kind === 'income' ? op.amount_minor : -op.amount_minor, op.currency, { sign: true })}
            </span>
            {op.orig_currency && op.orig_amount_minor !== null && <small className="mono">{money(op.orig_amount_minor, op.orig_currency)}</small>}
          </>
        )}
      </span>
    </button>
  );
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** «2026-10» → «Октябрь 2026». */
export function monthTitle(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  const name = MONTHS[mm - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export function shiftMonth(m: string, n: number): string {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Видимость по переключателю «Моё / Семья / Всё». */
export type Scope = 'mine' | 'family' | 'all';
export function inScope(a: MoneyAccount | undefined, scope: Scope): boolean {
  if (!a) return false;
  return scope === 'all' || (scope === 'family' ? a.shared : !a.shared);
}

export function ScopeSwitch({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  const { data, shown } = useMoney();
  if (!data.family || !shown('family') || !data.accounts.some((a) => a.shared)) return null;
  return (
    <div className="seg" role="group" aria-label="Чьи деньги">
      {(
        [
          ['mine', 'Моё'],
          ['family', 'Семья'],
          ['all', 'Всё'],
        ] as [Scope, string][]
      ).map(([id, label]) => (
        <button key={id} type="button" aria-pressed={scope === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Нижнее окно «Денег»: заголовок, крестик, закрытие по тапу мимо. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useSheet(box, onClose);
  return (
    <div className="sheet-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className="sheet m-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2 className="display" style={{ margin: 0, fontSize: 'calc(18px * var(--fs))', flex: 1 }}>
            {title}
          </h2>
          <button className="icon-btn bare" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

/** Шапка вложенного экрана: «назад» в «Ещё» и заголовок. */
export function SubHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="m-head">
      <Link className="icon-btn bare" href="/money/settings" aria-label="Назад">
        <Icon name="back" />
      </Link>
      <h1 className="display m-h1 m-h1-sub" style={{ flex: 1 }}>
        {title}
      </h1>
      {children}
    </header>
  );
}

/** «5 нояб», «сегодня», «завтра». */
export function shortDay(day: string, today: string): string {
  if (day === today) return 'сегодня';
  const t = new Date(`${today}T12:00:00`);
  t.setDate(t.getDate() + 1);
  if (day === t.toISOString().slice(0, 10)) return 'завтра';
  return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
