'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import { CityPicker } from './Weather';

/**
 * Настройки: город для погоды, время напоминаний о сроках, семья (общие
 * дела, а дальше — покупки). Тема — переключателем в панели.
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

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display">Настройки</h1>
      </div>
      <div className="home-grid">
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

        <section className="card" aria-labelledby="set-deadline">
          <h2 className="card-title display" id="set-deadline">
            <Icon name="bell" />
            Сроки дел
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
            Push за день до срока и в сам день — в это время. Нужны включённые уведомления (раздел «Напоминания»).
          </p>
          <form
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api('settings', 'PATCH', { deadline_time: time }), 'Сохранено');
            }}
          >
            <div className="fld">
              <label className="label" htmlFor="set-time">
                Во сколько
              </label>
              <input id="set-time" className="field mono" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <button className="btn btn-ghost" type="submit" disabled={time === s.deadline_time}>
              Сохранить
            </button>
          </form>
        </section>

        <section className="card" aria-labelledby="set-family" style={{ gridColumn: '1 / -1' }}>
          <h2 className="card-title display" id="set-family">
            <Icon name="users" />
            Семья
          </h2>
          {!hh ? (
            <>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                Семья — общие дела (а скоро и покупки) с близкими. У каждого свой вход; аккаунт заводится на сервере
                скриптом <code>scripts/add-user.mjs</code>.
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

      <section className="card" style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          Вы вошли как <b>{data.login}</b>
        </span>
        <button className="btn btn-ghost" type="button" onClick={logout}>
          <Icon name="logout" size={18} />
          Выйти
        </button>
      </section>

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
