'use client';

import { useState } from 'react';
import type { QuickItem } from '@/lib/aiParse';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { describe } from '@/lib/recur';
import { shortDate } from '@/lib/tasks';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * Общее для ИИ на экранах: признак «подключён», сжатие фото перед
 * отправкой и быстрый ввод фразой. Везде ИИ только ПРЕДЛАГАЕТ — сохраняет
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

function itemLabel(it: QuickItem, today: string): { kind: string; text: string; meta: string } {
  switch (it.type) {
    case 'task':
      return { kind: 'Дело', text: it.title, meta: [it.due_date ? `до ${shortDate(it.due_date, today)}` : 'срочно', it.tag].filter(Boolean).join(' · ') };
    case 'reminder':
      return { kind: 'Напоминание', text: it.title, meta: `${describe(it.rule)}, в ${it.times.join(', ')}` };
    case 'note':
      return { kind: 'Заметка', text: it.title || it.body.slice(0, 60), meta: it.title ? it.body.slice(0, 80) : '' };
    case 'shopping':
      return { kind: 'Покупка', text: it.name, meta: it.qty ? `${it.qty} ${it.unit ?? ''}` : '' };
  }
}

/** Сохранить предложенное ИИ обычными запросами. */
async function saveItems(items: QuickItem[]): Promise<void> {
  const shopping = items.filter((i): i is Extract<QuickItem, { type: 'shopping' }> => i.type === 'shopping');
  for (const it of items) {
    if (it.type === 'task') await api('tasks', 'POST', { title: it.title, due_date: it.due_date, tag: it.tag });
    if (it.type === 'reminder') await api('reminders', 'POST', { title: it.title, times: it.times, rule: it.rule, checklist_id: null });
    if (it.type === 'note') await api('notes', 'POST', { title: it.title, body: it.body });
  }
  if (shopping.length) await api('kitchen/shopping', 'POST', { items: shopping.map((s) => ({ name: s.name, qty: s.qty, unit: s.unit })) });
}

/**
 * «Скажите, что сделать»: фраза → дела, напоминания с повтором, заметки,
 * покупки. Например: «по вторникам и четвергам в 18:30 бассейн, а завтра
 * купить молоко и хлеб».
 */
export function QuickAdd({ plain = false }: { plain?: boolean }) {
  const { reload, toast, now } = useApp();
  const ready = useAiReady();
  const today = localDay(now);
  const [text, setText] = useState('');
  const [items, setItems] = useState<QuickItem[] | null>(null);
  const [pick, setPick] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  /** plain: Enter и «+» — просто дело, сразу; ✨ — разобрать фразу ИИ. */
  const addPlain = async () => {
    setBusy(true);
    try {
      await api('tasks', 'POST', { title: text.trim().slice(0, 200), due_date: null });
      await reload();
      toast('Дело добавлено');
      setText('');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const parse = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ items: QuickItem[] }>('ai/quick-add', 'POST', { text, today });
      setItems(r.items);
      setPick(r.items.map(() => true));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!items) return;
    setBusy(true);
    try {
      await saveItems(items.filter((_, i) => pick[i]));
      await reload();
      toast(`Добавлено: ${pick.filter(Boolean).length}`);
      setItems(null);
      setText('');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card ai-card quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        if (plain) addPlain();
        else parse();
      }}
      style={{ padding: 12, gap: 10, marginBottom: 12 }}
    >
      <div className="add-row" style={plain ? { flexWrap: 'nowrap' } : undefined}>
        <label className="sr-only" htmlFor="ai-quick">
          Скажите, что сделать
        </label>
        <input
          id="ai-quick"
          className="field"
          style={{ flex: 1 }}
          maxLength={1000}
          placeholder={plain ? 'Что нужно сделать?' : 'Скажите своими словами: «по вт и чт в 18:30 бассейн, завтра купить хлеб»'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {plain ? (
          <>
            <button className="btn btn-ai" type="button" disabled={busy || !text.trim()} onClick={() => parse()} aria-label="Разобрать своими словами (ИИ)" title="Разобрать своими словами: даты, повторы, покупки" style={{ padding: '0 12px' }}>
              <Icon name="sparkles" size={18} />
              {busy && !items && <span className="btn-text">Думаю…</span>}
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} aria-label="Добавить дело" style={{ padding: '0 12px' }}>
              <Icon name="plus" size={18} />
            </button>
          </>
        ) : (
          <button className="btn btn-ai" type="submit" disabled={busy || !text.trim()}>
            <Icon name="sparkles" size={18} />
            <span className="btn-text">{busy && !items ? 'Думаю…' : 'Разобрать'}</span>
          </button>
        )}
      </div>
      {items && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((it, i) => {
            const l = itemLabel(it, today);
            return (
              <label key={i} className="check" style={{ padding: '6px 4px', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={pick[i]} onChange={(e) => setPick(pick.map((p, j) => (j === i ? e.target.checked : p)))} />
                <span className="check-text">
                  <span className="tag" style={{ marginRight: 6 }}>
                    {l.kind}
                  </span>
                  <b style={{ fontWeight: 600 }}>{l.text}</b>
                  {l.meta && <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>{l.meta}</span>}
                </span>
              </label>
            );
          })}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="button" disabled={busy || !pick.some(Boolean)} onClick={save}>
              <Icon name="check" size={18} />
              Добавить выбранное ({pick.filter(Boolean).length})
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setItems(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </form>
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
      {text ? <p style={{ margin: 0, lineHeight: 1.6 }}>{text}</p> : <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Коротко о главном: сроки, напоминания, погода, что взять с собой.</p>}
      <AiButton busy={busy} onClick={make} style={{ alignSelf: 'flex-start' }}>
        {text ? 'Обновить' : 'Составить'}
      </AiButton>
    </section>
  );
}
