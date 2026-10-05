'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * Общее для ИИ на экранах: признак «подключён», сжатие фото перед
 * отправкой. Ввод задачи своими словами — в окне задачи (TaskDialog). Везде ИИ только ПРЕДЛАГАЕТ — сохраняет
 * человек сам, отметив нужное.
 */

export function useAiReady(): boolean {
  return !!useApp().data.ai;
}

/** Фото с телефона — до 1280 px по большей стороне, JPEG: быстро и в лимит сервера. */
export function compressImage(file: File, max = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не получилось открыть фото.'));
    };
    img.src = url;
  });
}

/** Кнопка с «искрами» — единый вид для ИИ-действий. */
export function AiButton({ children, busy, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className="btn btn-ai" type="button" disabled={busy || rest.disabled} {...rest}>
      <Icon name="sparkles" size={18} />
      {busy ? 'Думаю…' : children}
    </button>
  );
}

/** Сводка дня от ИИ — по кнопке; утром может прийти и сама (настройки). */
export function SummaryCard() {
  const { now, toast } = useApp();
  const ready = useAiReady();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  const make = async () => {
    setBusy(true);
    try {
      const r = await api<{ text: string }>('ai/summary', 'POST', { today: localDay(now) });
      setText(r.text);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card ai-card" aria-labelledby="home-summary">
      <div className="card-head">
        <h2 className="card-title display" id="home-summary">
          <Icon name="sparkles" />
          Сводка дня
        </h2>
      </div>
      {text ? <p style={{ margin: 0, lineHeight: 1.6 }}>{text}</p> : <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'calc(14px * var(--fs))' }}>Коротко о главном: сроки, напоминания, погода, что взять с собой.</p>}
      <AiButton busy={busy} onClick={make} style={{ alignSelf: 'flex-start' }}>
        {text ? 'Обновить' : 'Составить'}
      </AiButton>
    </section>
  );
}
