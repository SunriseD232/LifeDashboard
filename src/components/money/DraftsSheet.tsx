'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/currencies';
import { localDay } from '@/lib/dates';
import { convert } from '@/lib/money';
import type { MoneyDraft } from '@/lib/moneyAi';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';

const dayLabel = (day: string, today: string) => (day === today ? 'сегодня' : new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));

/**
 * Несколько операций из одной фразы или записи голоса: «продукты 1200 и
 * кофе 350». Лишнее можно убрать, любую — открыть и поправить, остальное
 * сохранить разом.
 */
export default function DraftsSheet({ ops: initial, said, onClose }: { ops: MoneyDraft[]; said?: string; onClose: () => void }) {
  const { data, reload, toast, rateOf, openOp } = useMoney();
  const [ops, setOps] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localDay();
  const fallback = data.accounts.find((a) => !a.archived);

  /** Тело запроса: сумма — в валюте счёта; назвали другую — это «платил в другой валюте». */
  function body(o: MoneyDraft) {
    const acc = data.accounts.find((a) => a.id === o.account_id) ?? fallback;
    if (!acc || !o.amount_minor) return null;
    const foreign = o.currency && o.currency !== acc.currency ? o.currency : null;
    const amount = foreign ? convert(o.amount_minor, foreign, acc.currency, rateOf) : o.amount_minor;
    if (!amount) return null;
    return {
      kind: o.kind ?? 'expense',
      day: o.day ?? today,
      account_id: acc.id,
      amount_minor: amount,
      to_account_id: o.to_account_id ?? null,
      to_amount_minor: o.to_amount_minor ?? null,
      category_id: o.category_id ?? null,
      payee: o.payee || null,
      note: o.note || null,
      source: o.source ?? 'text',
      ...(foreign ? { orig_amount_minor: o.amount_minor, orig_currency: foreign } : {}),
    };
  }

  async function saveAll() {
    setError(null);
    const bodies = ops.map(body);
    const bad = bodies.findIndex((b) => !b || ((b.kind === 'transfer' || b.kind === 'exchange') && (!b.to_account_id || (b.kind === 'exchange' && !b.to_amount_minor))));
    if (bad >= 0) return setError(`Операцию «${ops[bad].payee || bad + 1}» нужно поправить — нажмите на неё.`);
    setBusy(true);
    let saved = 0;
    try {
      for (const b of bodies) {
        await api('money/ops', 'POST', b!);
        saved++;
      }
      await reload();
      toast(saved === 1 ? 'Записано' : `Записано: ${saved}`);
      onClose();
    } catch (e) {
      // Часть уже сохранилась — убираем её из списка, чтобы не задвоить.
      setOps((list) => list.slice(saved));
      if (saved) await reload();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet m-sheet" role="dialog" aria-modal="true" aria-label="Черновики операций">
        <div className="sheet-head">
          <h2 className="display" style={{ margin: 0, fontSize: 'calc(18px * var(--fs))', flex: 1 }}>
            Нашёл {ops.length} {ops.length === 1 ? 'операцию' : ops.length < 5 ? 'операции' : 'операций'}
          </h2>
          <button className="icon-btn bare" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </div>
        {said && (
          <p className="m-said">
            <span className="muted">{initial[0]?.source === 'voice' ? 'Вы сказали' : 'Вы написали'}</span> «{said}»
          </p>
        )}
        <div className="m-card" style={{ gap: 0, padding: '0 6px' }}>
          {ops.map((o, i) => {
            const acc = data.accounts.find((a) => a.id === o.account_id) ?? fallback;
            const cat = data.categories.find((c) => c.id === o.category_id);
            const cur = o.currency ?? acc?.currency ?? data.settings!.base_currency;
            const sign = o.kind === 'income' ? 1 : -1;
            return (
              <div key={i} className="m-op m-draft">
                <button
                  type="button"
                  className="m-op-t m-link-row"
                  onClick={() => {
                    // Открываем одну — остальные остаются здесь не сохранёнными, поэтому
                    // предупреждаем, если их больше.
                    if (ops.length > 1 && !confirm('Остальные операции из списка не сохранятся. Открыть эту?')) return;
                    openOp(o);
                  }}
                >
                  <b>{o.payee || cat?.name || 'Без названия'}</b>
                  <small>{[cat && o.payee ? cat.name : null, acc?.name, dayLabel(o.day ?? today, today)].filter(Boolean).join(' · ')}</small>
                </button>
                <span className={`mono${sign > 0 ? ' m-pos' : ''}`}>{money(sign * (o.amount_minor ?? 0), cur, { sign: true })}</span>
                <button className="icon-btn bare" type="button" aria-label="Убрать" onClick={() => setOps((l) => l.filter((_, j) => j !== i))}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            );
          })}
        </div>
        {error && (
          <p className="m-error" role="alert">
            {error}
          </p>
        )}
        <div className="m-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" type="button" disabled={busy || !ops.length} onClick={saveAll} style={{ flex: 1 }}>
            Сохранить{ops.length > 1 ? ` все (${ops.length})` : ''}
          </button>
        </div>
      </section>
    </div>
  );
}
