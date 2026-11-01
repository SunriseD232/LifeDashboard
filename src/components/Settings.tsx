'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from './AppShell';
import FamilyCard from './Family';
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
  const { data, toast, logout, replayOnboarding } = useApp();
  const s = data.settings;
  const [changingCity, setChangingCity] = useState(!s.city);
  const params = useSearchParams();
  const router = useRouter();
  const old = params.get('tab');
  useEffect(() => {
    if (old && OLD_TABS[old]) router.replace(OLD_TABS[old]);
  }, [old, router]);

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

        <FamilyCard />

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
            <button className="btn btn-ghost" type="button" onClick={replayOnboarding}>
              <Icon name="reset" size={18} />
              Пройти знакомство заново
            </button>
            <Link href="/support">Написать в поддержку</Link>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" type="button" onClick={logout}>
              <Icon name="logout" size={18} />
              Выйти
            </button>
          </div>
        </section>
      </div>

    </>
  );
}
