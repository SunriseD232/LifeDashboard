'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import PushPanel from './PushPanel';
import { Icon } from './icons';
import { CityPicker } from './Weather';
import { AppearancePicker } from './ThemeToggle';
import { CalendarCard, RhythmCard } from './SettingsExtra';

// Старые ссылки на вкладки (?tab=…): «Главная» и «Меню» переехали на свои
// страницы, остальное — разделы этой.
const OLD_TABS: Record<string, string> = { home: '/settings/home', menu: '/settings/menu', family: '/settings#set-family', account: '/settings#set-account' };

/**
 * Настройки — одна страница, без вкладок: то, что нельзя поменять на месте.
 * Плитки и нижнее меню главной — кнопкой на главной (/settings/home),
 * разделы меню — в «Ещё» (/settings/menu), время по умолчанию можно
 * поставить и прямо в окне задачи.
 */
export default function Settings() {
  const { data, reload, toast, logout } = useApp();
  const s = data.settings;
  const hh = data.household;
  const [changingCity, setChangingCity] = useState(!s.city);
  const [hhName, setHhName] = useState('Семья');
  const [login, setLogin] = useState('');
  const [leaving, setLeaving] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const old = params.get('tab');
  useEffect(() => {
    if (old && OLD_TABS[old]) router.replace(OLD_TABS[old]);
  }, [old, router]);

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
  const hint = { margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' } as const;

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display">Настройки</h1>
      </div>

      <div className="settings-col">
        <section className="card" aria-labelledby="set-push">
          <h2 className="card-title display" id="set-push">
            <Icon name="bell" />
            Уведомления
          </h2>
          <PushPanel toast={toast} />
        </section>

        <RhythmCard />

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

        <section className="card" aria-labelledby="set-theme">
          <h2 className="card-title display" id="set-theme">
            <Icon name="moon" />
            Оформление
          </h2>
          <p style={hint}>Только на этом устройстве: на телефоне и компьютере можно по-разному.</p>
          <AppearancePicker />
        </section>

        <section className="card" aria-labelledby="set-family">
          <h2 className="card-title display" id="set-family">
            <Icon name="users" />
            Семья
          </h2>
          {!hh ? (
            <>
              <p style={hint}>Общие дела, чек-листы, рецепты и покупки с близкими. Создайте семью и добавьте человека по его логину — он должен быть зарегистрирован.</p>
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

        <CalendarCard />

        <section className="card" aria-labelledby="set-elsewhere">
          <h2 className="card-title display" id="set-elsewhere">
            <Icon name="settings" />
            Настраивается на месте
          </h2>
          <nav aria-label="Другие настройки" className="set-links">
            <Link href="/settings/home">
              <span>
                <b>Главная</b>
                <small>плитки, быстрые действия и нижнее меню; ещё шестерёнкой на самой главной</small>
              </span>
              <Icon name="arrow" size={18} />
            </Link>
            <Link href="/settings/menu">
              <span>
                <b>Разделы меню</b>
                <small>порядок и скрытые; на телефоне ещё из «Ещё»</small>
              </span>
              <Icon name="arrow" size={18} />
            </Link>
            <Link href="/money/settings">
              <span>
                <b>Деньги</b>
                <small>валюты, категории, что показывать</small>
              </span>
              <Icon name="arrow" size={18} />
            </Link>
          </nav>
        </section>

        <section className="card" aria-labelledby="set-account">
          <h2 className="card-title display" id="set-account">
            <Icon name="users" />
            Аккаунт и помощь
          </h2>
          <span style={{ overflowWrap: 'anywhere' }}>
            Вы вошли как <b>{data.login}</b>
          </span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/guide">Как пользоваться</Link>
            <Link href="/support">Написать в поддержку</Link>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" type="button" onClick={logout}>
              <Icon name="logout" size={18} />
              Выйти
            </button>
          </div>
        </section>
      </div>

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
