'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/currencies';
import { isTemp } from '@/lib/offline';
import type { MoneyOp } from '@/lib/money';
import { useMoney } from './MoneyShell';
import { Sheet } from './MoneyParts';

/** Почему выбранное нельзя соединить — или null, если можно. */
export function mergeBlock(ops: MoneyOp[]): string | null {
  if (ops.length < 2) return 'Отметьте ещё одну';
  const k = ops[0].kind;
  if (!(k === 'expense' || k === 'income') || ops.some((o) => o.kind !== k)) return 'Только траты с тратами или доходы с доходами';
  if (ops.some((o) => o.currency !== ops[0].currency)) return 'У операций разные валюты';
  if (ops.some((o) => o.debt_id)) return 'Операции долга не соединяются';
  if (ops.some((o) => isTemp(o.id))) return 'Есть неотправленные — дождитесь сети';
  return null;
}

/**
 * Какую оставить: с чеком (позиции не потеряются), потом записанную руками
 * или по фото (у SMS название места банковское), потом первую.
 */
function pickMain(ops: MoneyOp[]): MoneyOp {
  return ops.find((o) => o.items_count) ?? ops.find((o) => o.source !== 'sms' && o.payee) ?? ops[0];
}

const dayText = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/**
 * Соединить выбранные операции: сложить суммы (заплатили частями, два чека в
 * одном магазине) или убрать дубль (одна покупка пришла SMS и записана по чеку).
 */
export default function MergeSheet({ ops, onClose, onDone }: { ops: MoneyOp[]; onClose: () => void; onDone: () => void }) {
  const { reload, toast } = useMoney();
  const main = pickMain(ops);
  const equal = ops.every((o) => o.amount_minor === ops[0].amount_minor);
  // Одинаковые суммы из разных источников (SMS и чек) — скорее всего дубль.
  const [mode, setMode] = useState<'sum' | 'same'>(equal && new Set(ops.map((o) => o.source)).size > 1 ? 'same' : 'sum');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cur = ops[0].currency;
  const sign = ops[0].kind === 'income' ? 1 : -1;
  const total = mode === 'same' ? main.amount_minor : ops.reduce((s, o) => s + o.amount_minor, 0);
  const payee = main.payee ?? ops.find((o) => o.payee)?.payee ?? null;
  const category = main.category_name ?? ops.find((o) => o.category_name)?.category_name ?? null;
  const items = mode === 'same' ? (main.items_count || ops.find((o) => o.items_count)?.items_count || 0) : ops.reduce((s, o) => s + (o.items_count ?? 0), 0);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api('money/ops/merge', 'POST', { ids: ops.map((o) => o.id), main: main.id, mode });
      await reload();
      toast(mode === 'same' ? 'Дубль убран' : `Соединено: ${money(total, cur)}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Соединить ${ops.length} операци${ops.length < 5 ? 'и' : 'й'}`} onClose={onClose}>
      <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
        {ops.map((o) => (
          <div key={o.id} className="m-merge-row">
            <span className="m-op-t">
              <b>{o.payee || o.category_name || 'Без названия'}</b>
              <small>{[dayText(o.day), o.source === 'sms' ? 'из SMS' : null, o.items_count ? `чек, ${o.items_count} поз.` : null].filter(Boolean).join(' · ')}</small>
            </span>
            <span className="mono">{money(sign * o.amount_minor, cur, { sign: true })}</span>
          </div>
        ))}
      </div>
      <fieldset className="m-merge-modes" disabled={busy}>
        <legend className="sr-only">Как соединить</legend>
        <label className="m-check">
          <input type="radio" name="merge-mode" checked={mode === 'sum'} onChange={() => setMode('sum')} />
          <span>
            Сложить суммы
            <small className="muted"> — заплатили частями или это одна покупка из нескольких</small>
          </span>
        </label>
        {equal && (
          <label className="m-check">
            <input type="radio" name="merge-mode" checked={mode === 'same'} onChange={() => setMode('same')} />
            <span>
              Одна покупка записана дважды
              <small className="muted"> — например, пришла SMS и сфотографирован чек</small>
            </span>
          </label>
        )}
      </fieldset>
      <div className="m-merge-result">
        <small className="muted">Получится</small>
        <b>{payee ?? category ?? 'Операция'}</b>
        <span className={`mono m-merge-sum${sign > 0 ? ' m-pos' : ''}`}>{money(sign * total, cur, { sign: true })}</span>
        <small className="muted">{[dayText(main.day), category, items ? `чек, ${items} поз.` : null].filter(Boolean).join(' · ')}</small>
      </div>
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="button" disabled={busy} onClick={go}>
        {busy ? 'Соединяю…' : 'Соединить'}
      </button>
    </Sheet>
  );
}
