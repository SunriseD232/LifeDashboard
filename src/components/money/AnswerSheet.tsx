'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import type { MoneyDraft } from '@/lib/moneyAi';
import { Sheet } from './MoneyParts';
import { useMoney } from './MoneyShell';
import { showDrafts } from './VoiceSheet';

interface Turn {
  q: string;
  a: string;
  search: string | null;
}

type Say = { result: 'payment'; ops: MoneyDraft[] } | { result: 'question'; answer: string; search: string | null };

/**
 * Ответ ИИ на вопрос из строки ввода или голосом. Под ответом — «Показать
 * операции» (поиск в «Операциях») и «Спросить ещё»: уточняющий вопрос уходит
 * вместе с прошлыми, чтобы «а в прошлом месяце?» было понятно.
 */
export default function AnswerSheet({ q, a, search, onClose }: Turn & { onClose: () => void }) {
  const { open } = useMoney();
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([{ q, a, search }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = turns[turns.length - 1];

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<Say>('money/ai/say', 'POST', { text: t, today: localDay(), history: turns.map(({ q, a }) => ({ q, a })) });
      if (r.result === 'payment') return showDrafts(open, r.ops, t);
      setTurns((l) => [...l, { q: t, a: r.answer, search: r.search }]);
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Ответ" onClose={onClose}>
      {turns.map((t, i) => (
        <div key={i} className="m-answer" aria-live={i === turns.length - 1 ? 'polite' : undefined}>
          <small className="muted">{t.q}</small>
          <p>{t.a}</p>
        </div>
      ))}
      {last.search && (
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => {
            onClose();
            router.push(`/money/ops?q=${encodeURIComponent(last.search!)}`);
            // Если «Операции» уже открыты — пусть просто подставят поиск.
            window.dispatchEvent(new CustomEvent('money:ops-filter', { detail: { q: last.search } }));
          }}
        >
          Показать операции: «{last.search}»
        </button>
      )}
      <form className="m-row" onSubmit={ask}>
        <input className="field" placeholder="Спросить ещё: а в прошлом месяце?" aria-label="Уточняющий вопрос" value={text} maxLength={500} disabled={busy} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? <span className="m-spinner m-spinner-light" aria-hidden="true" /> : 'Спросить'}
        </button>
      </form>
      {error && (
        <p className="m-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}
