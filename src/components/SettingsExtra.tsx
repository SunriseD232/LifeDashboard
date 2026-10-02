'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { arrange, PHONE_SLOTS, type NavPref } from '@/lib/nav';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * Разделы меню: порядок стрелками, глаз — скрыть. Главная всегда первая,
 * на телефоне в нижней панели — она и первые три видимых.
 */
export function NavEditor() {
  const { data, mutate } = useApp();
  const nav = arrange(data.settings.nav);
  const items = nav.all;

  const save = (next: NavPref[] | null) =>
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, nav: next } }),
      () => api('settings', 'PATCH', { nav: next }),
    );
  const toPref = (list: typeof items): NavPref[] => list.map((s) => ({ href: s.href, hidden: s.hidden }));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    save(toPref(next));
  };
  const toggle = (i: number) => {
    const next = items.map((s, j) => (j === i ? { ...s, hidden: !s.hidden } : s));
    if (next.every((s) => s.hidden)) return;
    save(toPref(next));
  };

  return (
    <section className="card" aria-labelledby="set-nav">
      <h2 className="card-title display" id="set-nav">
        <Icon name="list" />
        Разделы меню
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Переставьте и скройте ненужное. На телефоне внизу — Главная и первые {PHONE_SLOTS} раздела, остальные — в «Ещё».</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((s, i) => {
          const onPhone = nav.phone.some((x) => x.href === s.href);
          return (
            <li key={s.href} className="nav-edit" data-hidden={s.hidden || undefined}>
              <Icon name={s.icon} size={18} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {s.label}
                {onPhone && <span className="tag" style={{ marginLeft: 8 }}>внизу</span>}
                {s.hidden && <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--muted)' }}>скрыт</span>}
              </span>
              <button className="icon-btn bare" type="button" aria-label={`${s.label} выше`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" size={18} />
              </button>
              <button className="icon-btn bare" type="button" aria-label={`${s.label} ниже`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <Icon name="down" size={18} />
              </button>
              <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} aria-pressed={!s.hidden} onClick={() => toggle(i)}>
                {s.hidden ? 'Показать' : 'Скрыть'}
              </button>
            </li>
          );
        })}
      </ol>
      {nav.custom && (
        <button className="btn btn-ghost" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => save(null)}>
          <Icon name="reset" size={16} />
          Как было
        </button>
      )}
    </section>
  );
}

/** Ссылка-подписка на календарь: дела со сроком и напоминания на 60 дней вперёд. */
export function CalendarCard() {
  const { data, reload, toast } = useApp();
  const token = data.settings.calendar_token;
  const [busy, setBusy] = useState(false);
  const https = typeof window !== 'undefined' && token ? `${window.location.origin}/task/api/calendar/${token}.ics` : '';
  const webcal = https.replace(/^https?:/, 'webcal:');

  const set = async (on: boolean) => {
    setBusy(true);
    try {
      await api('settings', 'PATCH', { calendar: on });
      await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(https);
      toast('Ссылка скопирована');
    } catch {
      toast('Не получилось скопировать — выделите ссылку вручную');
    }
  };

  return (
    <section className="card" aria-labelledby="set-cal">
      <h2 className="card-title display" id="set-cal">
        <Icon name="calendar" />
        Календарь
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
        Дела со сроком и напоминания появятся в Календаре iPhone, Google или Outlook и будут обновляться сами. Правки — здесь, в LifeDashboard.
      </p>
      {!token ? (
        <button className="btn btn-primary" type="button" disabled={busy} style={{ alignSelf: 'flex-start' }} onClick={() => set(true)}>
          <Icon name="calendar" size={18} />
          Получить ссылку
        </button>
      ) : (
        <>
          <input className="field mono" readOnly value={https} aria-label="Ссылка на календарь" onFocus={(e) => e.target.select()} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={webcal}>
              Добавить на iPhone / Mac
            </a>
            <button className="btn btn-ghost" type="button" onClick={copy}>
              Скопировать
            </button>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 14, color: 'var(--muted)', minHeight: 28 }}>Google Календарь и другое</summary>
            <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5 }}>
              Google: calendar.google.com → «Другие календари» → «+» → «Добавить по URL» → вставьте ссылку. Google обновляет такие календари раз в несколько часов.
              <br />
              Ссылка — как пароль к расписанию: не пересылайте её. Если утекла — перевыпустите.
            </p>
          </details>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => set(true)}>
              <Icon name="reset" size={16} />
              Перевыпустить
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => set(false)}>
              Отключить
            </button>
          </div>
        </>
      )}
    </section>
  );
}
