'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { countryName } from '@/lib/holidays';
import { parseHub } from '@/lib/hub';
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
      <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>Переставьте и скройте ненужное. На телефоне в меню «Дашборда» — Главная и первые {PHONE_SLOTS} раздела, остальные — в «Ещё».</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((s, i) => {
          const onPhone = nav.phone.some((x) => x.href === s.href);
          return (
            <li key={s.href} className="nav-edit" data-hidden={s.hidden || undefined}>
              <Icon name={s.icon} size={18} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {s.label}
                {onPhone && <span className="tag" style={{ marginLeft: 8 }}>внизу</span>}
                {s.hidden && <span style={{ marginLeft: 8, fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' }}>скрыт</span>}
              </span>
              <button className="icon-btn bare" type="button" aria-label={`${s.label} выше`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" size={18} />
              </button>
              <button className="icon-btn bare" type="button" aria-label={`${s.label} ниже`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <Icon name="down" size={18} />
              </button>
              <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px', fontSize: 'calc(13px * var(--fs))' }} aria-pressed={!s.hidden} onClick={() => toggle(i)}>
                {s.hidden ? 'Показать' : 'Скрыть'}
              </button>
            </li>
          );
        })}
      </ol>
      <MoneyToggle />
      {nav.custom && (
        <button className="btn btn-ghost" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => save(null)}>
          <Icon name="reset" size={16} />
          Как было
        </button>
      )}
    </section>
  );
}

/** «Деньги» в меню и на главной: их можно было выключить при знакомстве. */
function MoneyToggle() {
  const { data, mutate } = useApp();
  const hub = parseHub(data.settings.hub);
  const money = ['op', 'receipt', 'report', 'ops'];
  const set = (on: boolean) => {
    const next = { ...hub, noMoney: !on, off: on ? hub.off.filter((x) => !money.includes(x)) : [...new Set([...hub.off, ...money])] };
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, hub: next } }),
      () => api('settings', 'PATCH', { hub: next }),
    );
  };
  return (
    <div className="nav-edit" data-hidden={hub.noMoney || undefined}>
      <Icon name="wallet" size={18} />
      <span style={{ flex: 1, minWidth: 0 }}>
        Деньги
        {hub.noMoney && <span style={{ marginLeft: 8, fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' }}>скрыт</span>}
      </span>
      <button className="btn btn-ghost" type="button" style={{ minHeight: 36, padding: '4px 10px', fontSize: 'calc(13px * var(--fs))' }} aria-pressed={!hub.noMoney} onClick={() => set(hub.noMoney)}>
        {hub.noMoney ? 'Показать' : 'Скрыть'}
      </button>
    </div>
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
      <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>
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
            <summary style={{ cursor: 'pointer', fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)', minHeight: 28 }}>Google Календарь и другое</summary>
            <p style={{ margin: '6px 0 0', fontSize: 'calc(14px * var(--fs))', lineHeight: 1.5 }}>
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

/**
 * Праздники на календарях (задачи, главная, отпуска): включить и выбрать
 * страну. Страна помнится и при выключенных праздниках.
 */
export function HolidaysCard() {
  const { data, mutate } = useApp();
  const on = data.settings.holidays_on ?? true;
  const country = data.settings.holiday_country ?? 'RU';
  const [codes, setCodes] = useState<string[]>([country]);
  useEffect(() => {
    api<{ countries: string[] }>('holidays/countries')
      .then((r) => setCodes(r.countries))
      .catch(() => undefined);
  }, []);
  // Свои вперёд, дальше по алфавиту по-русски.
  const top = ['RU', 'BY', 'KZ'];
  const options = [...new Set([country, ...codes])]
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => (top.includes(a.code) ? top.indexOf(a.code) : 99) - (top.includes(b.code) ? top.indexOf(b.code) : 99) || a.name.localeCompare(b.name, 'ru'));
  const set = (patch: { holidays_on?: boolean; holiday_country?: string }) =>
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, ...patch } }),
      () => api('settings', 'PATCH', patch),
    );

  return (
    <section className="card" aria-labelledby="set-holidays" id="set-holidays">
      <h2 className="card-title display">
        <Icon name="sun" />
        Праздники
      </h2>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={on} onChange={(e) => set({ holidays_on: e.target.checked })} />
        <span className="check-text">Показывать праздники и выходные на календарях</span>
      </label>
      <div className="fld" style={{ maxWidth: 320 }}>
        <label className="label" htmlFor="set-holiday-country">
          Страна
        </label>
        <select id="set-holiday-country" className="field" value={country} disabled={!on} onChange={(e) => set({ holiday_country: e.target.value })}>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>
        {top.includes(country)
          ? 'По производственному календарю: с переносами выходных и рабочими субботами.'
          : 'Государственные праздники страны; переносов выходных для неё нет.'}
      </p>
    </section>
  );
}

/**
 * «Ритм дня» — всё, что про время: во сколько напоминать по умолчанию,
 * утренняя сводка, тихие часы, вечерний итог. Раньше это были три карточки.
 * Время сохраняется само, когда уходишь из поля.
 */
export function RhythmCard() {
  const { data, reload, toast } = useApp();
  const s = data.settings;
  const save = async (body: Record<string, unknown>, ok?: string) => {
    try {
      await api('settings', 'PATCH', body);
      await reload();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const timeField = (id: string, label: string, value: string, onSave: (v: string) => void) => (
    <div className="fld" style={{ maxWidth: 140 }}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field mono" type="time" defaultValue={value} onBlur={(e) => e.target.value && e.target.value !== value && onSave(e.target.value)} />
    </div>
  );
  const hint = { margin: 0, fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' } as const;
  return (
    <section className="card" aria-labelledby="set-rhythm">
      <h2 className="card-title display" id="set-rhythm">
        <Icon name="clock" />
        Ритм дня
      </h2>

      <div className="rhythm-row">
        {timeField('set-time', 'Напоминать по умолчанию в', s.deadline_time, (v) => save({ deadline_time: v }, 'Сохранено'))}
        <p style={hint}>Когда у задачи есть день, а время не указано: «Завтра» в окне задачи и свайпом, фраза без времени, задачи из заметки.</p>
      </div>

      {data.ai && (
        <div className="rhythm-row">
          <label className="check" style={{ padding: 0 }}>
            <input type="checkbox" checked={!!s.summary_time} onChange={(e) => save({ summary_time: e.target.checked ? '08:00' : null }, e.target.checked ? 'Сводка в 08:00' : 'Сводка выключена')} />
            <span className="check-text">Утренняя сводка от ИИ: сроки, напоминания, погода</span>
          </label>
          {s.summary_time && timeField('set-summary-time', 'Во сколько', s.summary_time, (v) => save({ summary_time: v }, 'Сохранено'))}
        </div>
      )}

      <div className="rhythm-row">
        <label className="check" style={{ padding: 0 }}>
          <input type="checkbox" checked={!!s.quiet_from} onChange={(e) => save(e.target.checked ? { quiet_from: '23:00', quiet_to: '07:00' } : { quiet_from: null, quiet_to: null })} />
          <span className="check-text">Тихие часы: ночью без уведомлений</span>
        </label>
        {s.quiet_from && s.quiet_to && (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              {timeField('q-from', 'С', s.quiet_from, (v) => save({ quiet_from: v, quiet_to: s.quiet_to }, 'Сохранено'))}
              {timeField('q-to', 'До', s.quiet_to, (v) => save({ quiet_from: s.quiet_from, quiet_to: v }, 'Сохранено'))}
            </div>
            <p style={hint}>Что пришлось на это время и не отмечено, придёт одним сообщением утром.</p>
          </>
        )}
      </div>

      <div className="rhythm-row">
        <label className="check" style={{ padding: 0 }}>
          <input type="checkbox" checked={!!s.review_time} onChange={(e) => save({ review_time: e.target.checked ? '21:00' : null }, e.target.checked ? 'Итог дня в 21:00' : undefined)} />
          <span className="check-text">Итог дня вечером: перенести несделанное на завтра</span>
        </label>
        {s.review_time && timeField('rev-time', 'Во сколько', s.review_time, (v) => save({ review_time: v }, 'Сохранено'))}
      </div>
    </section>
  );
}
