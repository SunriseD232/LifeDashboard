'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { addDays, appliesOn, dayTitle, hhmm, inMinutes, localDay, minutesOf, plural, weekdayName } from '@/lib/dates';
import { REPEAT_LABELS, type Reminder, type Repeat } from '@/lib/types';
import type { AppData, Mutate } from './App';
import Confirm from './Confirm';
import PushPanel from './PushPanel';
import { Icon } from './icons';

interface Props {
  data: AppData;
  mutate: Mutate;
  reload: () => Promise<void>;
  now: Date;
  onOpenChecklist: (id: string) => void;
  toast: (m: string) => void;
}

interface Draft {
  id: string | null;
  title: string;
  at_time: string;
  repeat: Repeat;
  on_date: string;
  checklist_id: string;
}

const NOTIFIED_KEY = 'lifedashboard:notified';

function emptyDraft(now: Date): Draft {
  // По умолчанию — ближайший целый час, чтобы не листать часы с нуля.
  const h = Math.min(23, now.getHours() + 1);
  return { id: null, title: '', at_time: `${String(h).padStart(2, '0')}:00`, repeat: 'once', on_date: localDay(now), checklist_id: '' };
}

export default function Reminders({ data, mutate, reload, now, onOpenChecklist, toast }: Props) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(now));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<Reminder | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const today = localDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todays = data.reminders.filter((r) => appliesOn(r, now)).sort((a, b) => a.at_time.localeCompare(b.at_time));
  const done = new Set(data.done);
  const doneCount = todays.filter((r) => done.has(r.id)).length;
  const next = todays.find((r) => !done.has(r.id) && minutesOf(r.at_time) >= nowMin);
  const tomorrow = addDays(now, 1);
  const tomorrowList = data.reminders.filter((r) => appliesOn(r, tomorrow)).sort((a, b) => a.at_time.localeCompare(b.at_time));
  const listName = (id: string | null) => data.checklists.find((c) => c.id === id)?.title ?? null;

  // Подсказка в момент дела, пока вкладка открыта. Системное уведомление
  // присылает сервер push'ем (PushPanel, src/lib/push.ts) — здесь только
  // тост, чтобы не было двух одинаковых оповещений. Помним уже показанные за
  // сутки, чтобы не повторять при каждом тике и перезагрузке.
  useEffect(() => {
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let shown: string[] = [];
    try {
      shown = JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || '[]');
    } catch {
      shown = [];
    }
    for (const r of todays) {
      const key = `${today}:${r.id}`;
      if (done.has(r.id) || hhmm(r.at_time) !== hm || shown.includes(key)) continue;
      shown.push(key);
      toast(`Пора: ${r.title}`);
    }
    try {
      sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(shown.slice(-100)));
    } catch {
      /* приватный режим */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const toggleDone = (r: Reminder, value: boolean) =>
    mutate(
      (d) => ({ ...d, done: value ? [...d.done, r.id] : d.done.filter((x) => x !== r.id) }),
      () => api(`reminders/${r.id}/done`, 'PUT', { day: today, done: value }),
    );

  const startEdit = (r: Reminder) => {
    setDraft({
      id: r.id,
      title: r.title,
      at_time: hhmm(r.at_time),
      repeat: r.repeat,
      on_date: r.on_date ?? today,
      checklist_id: r.checklist_id ?? '',
    });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => titleRef.current?.focus(), 250);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || !draft.at_time) return;
    setSaving(true);
    const body = {
      title: draft.title.trim(),
      at_time: draft.at_time,
      repeat: draft.repeat,
      on_date: draft.repeat === 'once' ? draft.on_date : null,
      checklist_id: draft.checklist_id || null,
    };
    try {
      if (draft.id) await api(`reminders/${draft.id}`, 'PATCH', body);
      else await api('reminders', 'POST', body);
      await reload();
      setDraft(emptyDraft(now));
      toast(draft.id ? 'Напоминание сохранено' : 'Напоминание добавлено');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rem-layout">
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <h1 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.1 }}>
              Сегодня
            </h1>
            <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
              {dayTitle(now)}
              {todays.length > 0 && ` · ${doneCount} из ${todays.length} сделано`}
            </p>
          </div>
          {todays.length > 0 && (
            <div className="bar warm" style={{ flex: '0 1 220px' }} aria-hidden="true">
              <i style={{ width: `${(doneCount / todays.length) * 100}%` }} />
            </div>
          )}
        </div>

        <PushPanel toast={toast} />

        {todays.length === 0 ? (
          <div className="panel" style={{ padding: 24, color: 'var(--muted)' }}>
            На сегодня дел нет. Добавьте первое напоминание — например, «Собрать сумку в бассейн» на вечер.
          </div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {todays.map((r) => {
              const isDone = done.has(r.id);
              const isNext = next?.id === r.id;
              const past = !isDone && minutesOf(r.at_time) < nowMin;
              const list = listName(r.checklist_id);
              return (
                <li key={r.id} className={`rem-row${isNext ? ' next' : ''}`}>
                  <span className="mono" style={{ width: 52, flex: 'none', paddingTop: 1, color: isNext ? 'var(--warm)' : 'var(--muted)' }}>
                    {hhmm(r.at_time)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className={`check${isDone ? ' done' : ''}`} style={{ padding: 0, minHeight: 0, alignItems: 'flex-start', gap: 10 }}>
                      <input type="checkbox" checked={isDone} onChange={(e) => toggleDone(r, e.target.checked)} />
                      <span className="check-text" style={isDone ? undefined : { fontWeight: 600 }}>
                        {r.title}
                      </span>
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingLeft: 32 }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <Icon name="repeat" size={14} />
                        {REPEAT_LABELS[r.repeat]}
                      </span>
                      {list && r.checklist_id && (
                        <button className="chip" type="button" onClick={() => onOpenChecklist(r.checklist_id!)}>
                          <Icon name="list" size={14} />
                          Чек-лист «{list}»
                        </button>
                      )}
                      {isNext && (
                        <span className="badge" style={{ background: '#fff' }}>
                          {inMinutes(minutesOf(r.at_time) - nowMin)}
                        </span>
                      )}
                      {past && <span style={{ fontSize: 13, color: 'var(--warm)' }}>время прошло</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="icon-btn bare" type="button" aria-label={`Изменить «${r.title}»`} onClick={() => startEdit(r)}>
                      <Icon name="edit" size={18} />
                    </button>
                    <button className="icon-btn bare" type="button" aria-label={`Удалить «${r.title}»`} onClick={() => setConfirm(r)}>
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <form ref={formRef} className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={submit}>
          <h2 className="display" style={{ margin: 0, fontSize: 20 }}>
            {draft.id ? 'Изменить напоминание' : 'Новое напоминание'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="label" htmlFor="r-what">
              Что сделать
            </label>
            <input
              ref={titleRef}
              id="r-what"
              className="field"
              maxLength={120}
              placeholder="Например, взять пропуск"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="label" htmlFor="r-time">
                Время
              </label>
              <input id="r-time" className="field mono" type="time" required value={draft.at_time} onChange={(e) => setDraft({ ...draft, at_time: e.target.value })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="label" htmlFor="r-list">
                Чек-лист
              </label>
              <select id="r-list" className="field" value={draft.checklist_id} onChange={(e) => setDraft({ ...draft, checklist_id: e.target.value })}>
                <option value="">Без чек-листа</option>
                {data.checklists.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <legend className="label" style={{ padding: 0, marginBottom: 6 }}>
              Повторять
            </legend>
            <div className="seg">
              {(['once', 'daily', 'weekdays'] as Repeat[]).map((rep) => (
                <button key={rep} type="button" aria-pressed={draft.repeat === rep} onClick={() => setDraft({ ...draft, repeat: rep })}>
                  {rep === 'once' ? 'Один раз' : rep === 'daily' ? 'Каждый день' : 'По будням'}
                </button>
              ))}
            </div>
          </fieldset>
          {draft.repeat === 'once' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="label" htmlFor="r-date">
                День
              </label>
              <input id="r-date" className="field" type="date" min={today} value={draft.on_date} onChange={(e) => setDraft({ ...draft, on_date: e.target.value })} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={saving || !draft.title.trim()} style={{ flex: 1 }}>
              <Icon name={draft.id ? 'check' : 'plus'} size={18} />
              {saving ? 'Сохраняем…' : draft.id ? 'Сохранить' : 'Добавить'}
            </button>
            {draft.id && (
              <button className="btn btn-ghost" type="button" onClick={() => setDraft(emptyDraft(now))}>
                Отмена
              </button>
            )}
          </div>
        </form>

        <section style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="group-title" style={{ padding: 0 }}>
            Завтра, {weekdayName(tomorrow)}
          </h2>
          {tomorrowList.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Пока ничего.</p>
          ) : (
            tomorrowList.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 12, color: 'var(--muted)' }}>
                <span className="mono" style={{ width: 52, flex: 'none' }}>
                  {hhmm(r.at_time)}
                </span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r.title}</span>
              </div>
            ))
          )}
          {tomorrowList.length > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{plural(tomorrowList.length, 'дело', 'дела', 'дел')}</p>
          )}
        </section>
      </aside>

      <button
        className="btn btn-primary fab only-mobile"
        type="button"
        onClick={() => {
          setDraft(emptyDraft(now));
          formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => titleRef.current?.focus(), 300);
        }}
      >
        <Icon name="plus" size={20} />
        Напоминание
      </button>

      {confirm && (
        <Confirm
          title={`Удалить «${confirm.title}»?`}
          text={confirm.repeat === 'once' ? 'Напоминание удалится.' : `Напоминание ${REPEAT_LABELS[confirm.repeat]} удалится целиком, со всеми днями.`}
          action="Удалить"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const r = confirm;
            setConfirm(null);
            mutate(
              (d) => ({ ...d, reminders: d.reminders.filter((x) => x.id !== r.id), done: d.done.filter((x) => x !== r.id) }),
              () => api(`reminders/${r.id}`, 'DELETE'),
            );
          }}
        />
      )}
    </div>
  );
}
