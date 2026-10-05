'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import PushPanel from './PushPanel';
import { Icon } from './icons';
import { CityPicker } from './Weather';
import { AppearancePicker } from './ThemeToggle';
import { CalendarCard, NavEditor, QuietCard } from './SettingsExtra';

type Tab = 'main' | 'menu' | 'family' | 'account';
const TABS: { id: Tab; label: string }[] = [
  { id: 'main', label: 'Основное' },
  { id: 'menu', label: 'Меню' },
  { id: 'family', label: 'Семья' },
  { id: 'account', label: 'Аккаунт' },
];

/**
 * Настройки — четыре коротких группы вкладками: «Основное» (город, тема,
 * уведомления, сроки, сводка), «Меню и календарь», «Семья», «Аккаунт».
 * Вкладка — в адресе (?tab=), чтобы на неё можно было сослаться.
 */
export default function Settings() {
  const { data, reload, toast, logout } = useApp();
  const s = data.settings;
  const hh = data.household;
  const [changingCity, setChangingCity] = useState(!s.city);
  const [time, setTime] = useState(s.deadline_time);
  const [hhName, setHhName] = useState('Семья');
  const [login, setLogin] = useState('');
  const [leaving, setLeaving] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await reload();
      if (ok) toast(ok);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const me = hh?.members.find((m) => m.me)?.login;
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('tab');
  const tab: Tab = TABS.some((t) => t.id === q) ? (q as Tab) : 'main';

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display">Настройки</h1>
      </div>
      <div className="tabs-row" role="tablist" aria-label="Группы настроек" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => router.replace(t.id === 'main' ? '/settings' : `/settings?tab=${t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'main' && (
      <div className="settings-col">
        <section className="card" aria-labelledby="set-weather">
          <h2 className="card-title display" id="set-weather">
            <Icon name="partly" />
            Погода
          </h2>
          {s.city && !changingCity ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1 }}>
                Город: <b>{s.city}</b>
              </span>
              <button className="btn btn-ghost" type="button" onClick={() => setChangingCity(true)}>
                Сменить
              </button>
            </div>
          ) : (
            <CityPicker onPicked={() => setChangingCity(false)} />
          )}
        </section>

        <section className="card" aria-labelledby="set-push">
          <h2 className="card-title display" id="set-push">
            <Icon name="bell" />
            Уведомления
          </h2>
          <PushPanel toast={toast} />
        </section>

        <section className="card" aria-labelledby="set-deadline">
          <h2 className="card-title display" id="set-deadline">
            <Icon name="bell" />
            Время напоминания по умолчанию
          </h2>
          <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>
            Подставляется, когда день у задачи есть, а время не указано: свайп «Завтра» у задачи без даты, фраза для ИИ без времени («завтра купить хлеб»), задачи,
            найденные в заметке.
          </p>
          <div className="fld" style={{ maxWidth: 160 }}>
            <label className="label" htmlFor="set-time">
              Во сколько
            </label>
            <input
              id="set-time"
              className="field mono"
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={() => time && time !== s.deadline_time && run(() => api('settings', 'PATCH', { deadline_time: time }), 'Сохранено')}
            />
          </div>
        </section>

        <QuietCard />

        {data.ai && (
          <section className="card ai-card" aria-labelledby="set-summary">
            <h2 className="card-title display" id="set-summary">
              <Icon name="sparkles" />
              Сводка дня
            </h2>
            <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>Каждое утро — push от ИИ: сроки, напоминания, погода, что взять с собой.</p>
            <label className="check" style={{ padding: 0 }}>
              <input
                type="checkbox"
                checked={!!s.summary_time}
                onChange={(e) => run(() => api('settings', 'PATCH', { summary_time: e.target.checked ? '08:00' : null }), e.target.checked ? 'Сводка в 08:00' : 'Сводка выключена')}
              />
              <span className="check-text">Присылать сводку</span>
            </label>
            {s.summary_time && (
              <div className="fld">
                <label className="label" htmlFor="set-summary-time">
                  Во сколько
                </label>
                <input
                  id="set-summary-time"
                  className="field mono"
                  type="time"
                  defaultValue={s.summary_time}
                  onBlur={(e) => e.target.value && e.target.value !== s.summary_time && run(() => api('settings', 'PATCH', { summary_time: e.target.value }), 'Сохранено')}
                />
              </div>
            )}
          </section>
        )}

        <section className="card" aria-labelledby="set-theme">
          <h2 className="card-title display" id="set-theme">
            <Icon name="moon" />
            Оформление
          </h2>
          <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>Только на этом устройстве: на телефоне и компьютере можно по-разному.</p>
          <AppearancePicker />
        </section>
      </div>
      )}

      {tab === 'menu' && (
        <div className="settings-col">
          <NavEditor />
          <CalendarCard />
        </div>
      )}

      {tab === 'family' && (
      <div className="settings-col">
        <section className="card" aria-labelledby="set-family">
          <h2 className="card-title display" id="set-family">
            <Icon name="users" />
            Семья
          </h2>
          {!hh ? (
            <>
              <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>
                Общие дела, чек-листы, рецепты и покупки с близкими. Создайте семью и добавьте человека по его логину — он должен быть зарегистрирован.
              </p>
              <form
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => api('household', 'POST', { name: hhName }), 'Семья создана');
                }}
              >
                <label className="sr-only" htmlFor="hh-name">
                  Название
                </label>
                <input id="hh-name" className="field" style={{ maxWidth: 280 }} maxLength={60} value={hhName} onChange={(e) => setHhName(e.target.value)} />
                <button className="btn btn-primary" type="submit" disabled={!hhName.trim()}>
                  <Icon name="plus" size={18} />
                  Создать семью
                </button>
              </form>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>{hh.name}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {hh.members.map((m) => (
                  <li key={m.login} className="task-row" style={{ padding: '6px 0' }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {m.login}
                      {m.me && <span style={{ color: 'var(--muted)' }}> — это вы</span>}
                    </span>
                    {!m.me && (
                      <button
                        className="icon-btn bare"
                        type="button"
                        aria-label={`Убрать ${m.login} из семьи`}
                        onClick={() => run(() => api(`household/members/${encodeURIComponent(m.login)}`, 'DELETE'), `${m.login} больше не в семье`)}
                      >
                        <Icon name="x" size={18} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => api('household/members', 'POST', { login }), 'Добавили в семью').then(() => setLogin(''));
                }}
              >
                <label className="sr-only" htmlFor="hh-login">
                  Логин
                </label>
                <input id="hh-login" className="field" style={{ maxWidth: 280 }} placeholder="Логин человека" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} />
                <button className="btn btn-ghost" type="submit" disabled={!login.trim()}>
                  <Icon name="plus" size={18} />
                  Добавить
                </button>
                <span style={{ flex: 1 }} />
                <button className="btn btn-danger-ghost" type="button" onClick={() => setLeaving(true)}>
                  Выйти из семьи
                </button>
              </form>
            </>
          )}
        </section>
      </div>
      )}

      {tab === 'account' && (
        <div className="settings-col">
          <section className="card" aria-labelledby="set-account">
            <h2 className="card-title display" id="set-account">
              <Icon name="users" />
              Аккаунт
            </h2>
            <span style={{ overflowWrap: 'anywhere' }}>
              Вы вошли как <b>{data.login}</b>
            </span>
            <button className="btn btn-ghost" type="button" onClick={logout} style={{ alignSelf: 'flex-start' }}>
              <Icon name="logout" size={18} />
              Выйти
            </button>
          </section>
          <section className="card" aria-labelledby="set-help">
            <h2 className="card-title display" id="set-help">
              <Icon name="help" />
              Помощь
            </h2>
            <Link href="/guide">Как пользоваться</Link>
            <Link href="/support">Написать в поддержку</Link>
          </section>
        </div>
      )}

      {leaving && me && (
        <Confirm
          title="Выйти из семьи?"
          text="Общие дела останутся у остальных. Если вы последний — семья удалится, а общие дела станут личными у их авторов."
          action="Выйти"
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            setLeaving(false);
            run(() => api(`household/members/${encodeURIComponent(me)}`, 'DELETE'), 'Вы вышли из семьи');
          }}
        />
      )}
    </>
  );
}
