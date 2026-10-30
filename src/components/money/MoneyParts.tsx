'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/currencies';
import { addDays, localDay } from '@/lib/dates';
import { quickParse, type MoneyAccount, type MoneyOp } from '@/lib/money';
import { needsAi, type MoneyDraft } from '@/lib/moneyAi';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { showDrafts } from './VoiceSheet';

/**
 * Строка быстрого ввода: «кофе 350», «такси 12 € вчера» — разбираем сами и
 * открываем окно операции уже заполненным; длинное или с несколькими
 * суммами («продукты 1200 и кофе 350») — разбирает ИИ. Рядом — голос и
 * фото чека, если включены.
 */
export function QuickBar() {
  const { data, openOp, open, aiOn, toast } = useMoney();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
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
    if (!aiOn() || !needsAi(t, p.amount_minor !== null)) {
      local(t);
      setText('');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ ops: MoneyDraft[] }>('money/ai/text', 'POST', { text: t, today: localDay() });
      showDrafts(open, res.ops, t);
      setText('');
    } catch (err) {
      // ИИ не ответил — простой разбор лучше, чем ничего.
      if (p.amount_minor !== null) {
        local(t);
        setText('');
      } else toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const typed = !!text.trim();
  return (
    <form className="m-qbar" onSubmit={submit} aria-label="Быстрый ввод" aria-busy={busy}>
      <label htmlFor="m-quick" className="sr-only">
        Что потратили
      </label>
      <input id="m-quick" className="field" type="text" enterKeyHint="done" autoComplete="off" placeholder="Кофе 350, такси 12 € вчера…" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
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
      <button className="icon-btn m-qbar-go" type="submit" disabled={busy} aria-label={typed ? 'Записать' : 'Новая операция'}>
        {busy ? <span className="m-spinner m-spinner-light" aria-hidden="true" /> : <Icon name={typed ? 'arrow' : 'plus'} size={22} />}
      </button>
    </form>
  );
}

const KIND_ICON: Record<MoneyOp['kind'], string> = { expense: 'cart', income: 'plus', transfer: 'arrow', exchange: 'exchange' };
const KIND_LABEL: Record<MoneyOp['kind'], string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', exchange: 'Обмен' };

/** Одна операция в списке: что, откуда, сколько. Нажатие — открыть. */
export function OpRow({ op, accounts }: { op: MoneyOp; accounts: MoneyAccount[] }) {
  const { openOp } = useMoney();
  const from = accounts.find((a) => a.id === op.account_id);
  const to = accounts.find((a) => a.id === op.to_account_id);
  const title = op.payee || (op.kind === 'expense' || op.kind === 'income' ? op.category_name : null) || KIND_LABEL[op.kind];
  const meta = [
    op.kind === 'transfer' || op.kind === 'exchange' ? `${from?.name ?? '?'} → ${to?.name ?? '?'}` : op.payee ? op.category_name : null,
    op.kind === 'transfer' || op.kind === 'exchange' ? null : from?.name,
    op.items_count ? `чек, ${op.items_count} поз.` : null,
    op.author,
  ].filter(Boolean);
  return (
    <button type="button" className="m-op" onClick={() => openOp(op)}>
      <span className="m-op-ic">
        <Icon name={op.items_count ? 'receipt' : KIND_ICON[op.kind]} />
      </span>
      <span className="m-op-t">
        <b>{title}</b>
        {meta.length > 0 && <small>{meta.join(' · ')}</small>}
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
