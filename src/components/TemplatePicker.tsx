'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { localDay, plural } from '@/lib/dates';
import { addDays, dayLabel } from '@/lib/recur';
import { CHECKLIST_TEMPLATES, type ChecklistTemplate } from '@/lib/templates';
import { AiButton, useAiReady } from './Ai';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';
import { Sheet, useIsPhone } from './Phone';

/**
 * Чек-лист из шаблона. У поездок — дата отъезда: тогда в названии будет дата,
 * а накануне в 20:00 придёт напоминание собраться (с этим чек-листом).
 */
const AI_TRIP: ChecklistTemplate = { id: 'ai-trip', title: 'Под мою поездку', icon: 'suitcase', description: 'ИИ соберёт под место, сезон и цель', trip: true, items: [] };

export default function TemplatePicker({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { reload, toast, now } = useApp();
  const today = localDay(now);
  const [pick, setPick] = useState<ChecklistTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false);
  const aiReady = useAiReady();
  const phone = useIsPhone();
  const [where, setWhere] = useState('');
  const [tripDays, setTripDays] = useState('3');
  const [purpose, setPurpose] = useState('');
  const [thinking, setThinking] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useModalFocus(boxRef);

  useEffect(() => {
    boxRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pick]);

  const choose = (t: ChecklistTemplate) => {
    setPick(t);
    setTitle(t.title);
  };

  /** ИИ: свой чек-лист под конкретную поездку — место, сезон, цель. */
  const generate = async () => {
    if (!where.trim()) return;
    setThinking(true);
    try {
      const r = await api<{ title: string; items: { title: string; group_name: string }[] }>('ai/trip-checklist', 'POST', { where, days: Number(tripDays), purpose, date: date || null });
      setPick({ ...AI_TRIP, items: r.items });
      setTitle(r.title);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick || !title.trim() || !pick.items.length) return;
    setBusy(true);
    try {
      const name = date ? `${title.trim()} · ${dayLabel(date)}` : title.trim();
      const { id } = await api<{ id: string }>('checklists', 'POST', { title: name.slice(0, 80), icon: pick.icon, items: pick.items });
      // Накануне отъезда; уезжаем сегодня — значит, сегодня.
      if (pick.trip && date && remind) {
        const day = addDays(date, -1) < today ? today : addDays(date, -1);
        await api('reminders', 'POST', { title: `Собраться: ${title.trim()}`, times: ['20:00'], rule: { kind: 'once', date: day }, checklist_id: id });
      }
      await reload();
      toast(pick.trip && date && remind ? 'Чек-лист готов, напомним собраться накануне' : 'Чек-лист готов');
      onCreated(id);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  const content = (
    <>
        {!pick ? (
          <>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Возьмите готовый и поправьте под себя.</p>
            <div className="tpl-grid">
              {aiReady && (
                <button type="button" className="list-card ai-card" onClick={() => choose(AI_TRIP)}>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="list-icon" style={{ width: 36, height: 36 }}>
                      <Icon name="sparkles" size={18} />
                    </span>
                    <span style={{ fontWeight: 600 }}>{AI_TRIP.title}</span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{AI_TRIP.description}</span>
                </button>
              )}
              {CHECKLIST_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="list-card" onClick={() => choose(t)}>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="list-icon" style={{ width: 36, height: 36 }}>
                      <Icon name={t.icon} size={18} />
                    </span>
                    <span style={{ fontWeight: 600 }}>{t.title}</span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {t.description} · {plural(t.items.length, 'пункт', 'пункта', 'пунктов')}
                  </span>
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" type="button" onClick={onClose} style={{ alignSelf: 'flex-end' }}>
              Отмена
            </button>
          </>
        ) : (
          <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pick.id === AI_TRIP.id && (
              <>
                <div className="task-fields">
                  <div className="fld">
                    <label className="label" htmlFor="tpl-where">
                      Куда
                    </label>
                    <input id="tpl-where" className="field" maxLength={100} placeholder="Сочи, Питер, горы…" value={where} onChange={(e) => setWhere(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label className="label" htmlFor="tpl-days">
                      Дней
                    </label>
                    <input id="tpl-days" className="field mono" type="number" min={1} max={60} value={tripDays} onChange={(e) => setTripDays(e.target.value)} />
                  </div>
                </div>
                <div className="fld">
                  <label className="label" htmlFor="tpl-purpose">
                    Зачем <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— море, командировка, поход, с ребёнком…</span>
                  </label>
                  <input id="tpl-purpose" className="field" maxLength={100} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                </div>
              </>
            )}
            <div className="fld">
              <label className="label" htmlFor="tpl-title">
                Название
              </label>
              <input id="tpl-title" className="field" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {pick.trip && (
              <>
                <div className="fld">
                  <label className="label" htmlFor="tpl-date">
                    Когда отъезд <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— необязательно</span>
                  </label>
                  <input id="tpl-date" className="field" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                {date && (
                  <label className="check" style={{ padding: 0 }}>
                    <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
                    <span className="check-text">Напомнить собраться накануне в 20:00</span>
                  </label>
                )}
              </>
            )}
            {pick.id === AI_TRIP.id && (
              <AiButton busy={thinking} disabled={!where.trim()} onClick={generate} style={{ alignSelf: 'flex-start' }}>
                {pick.items.length ? 'Собрать заново' : 'Собрать список'}
              </AiButton>
            )}
            {pick.items.length > 0 && (
              <details open={pick.id === AI_TRIP.id}>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: 'var(--muted)', minHeight: 28 }}>Что внутри · {pick.items.length}</summary>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>{pick.items.map((i) => i.title).join(', ')}</p>
              </details>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" type="button" onClick={() => setPick(null)}>
                Назад
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !title.trim() || !pick.items.length}>
                <Icon name="plus" size={18} />
                Создать чек-лист
              </button>
            </div>
          </form>
        )}
    </>
  );
  // На телефоне — окном снизу, как остальные формы.
  if (phone) {
    return (
      <Sheet title={pick ? pick.title : 'Чек-лист из шаблона'} onClose={onClose}>
        {content}
      </Sheet>
    );
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div ref={boxRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="tpl-dlg" style={{ width: 'min(560px, 100%)', maxHeight: '90dvh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 id="tpl-dlg" className="display" style={{ margin: 0, fontSize: 20 }}>
          {pick ? pick.title : 'Чек-лист из шаблона'}
        </h2>
        {content}
      </div>
    </div>
  );
}
