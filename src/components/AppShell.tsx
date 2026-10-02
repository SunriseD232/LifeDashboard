'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { appliesOn, dayTitle, localDay } from '@/lib/dates';
import type { Checklist, ChecklistItem, Reminder } from '@/lib/types';
import { Icon } from './icons';
import Login from './Login';
import ThemeToggle from './ThemeToggle';

export interface AppData {
  checklists: Checklist[];
  items: ChecklistItem[];
  reminders: Reminder[];
  /** id напоминаний, отмеченных сделанными СЕГОДНЯ. */
  done: string[];
  /** Логин вошедшего (в next dev с LD_DEV_USER — null). */
  login?: string | null;
}

export type Mutate = (update: (d: AppData) => AppData, request: () => Promise<unknown>) => void;

interface AppContext {
  data: AppData;
  mutate: Mutate;
  reload: () => Promise<void>;
  toast: (message: string) => void;
  /** «Сейчас», обновляется раз в 30 секунд. */
  now: Date;
  /** Какой чек-лист открыт — общий, чтобы напоминание могло открыть свой. */
  openList: string | null;
  setOpenList: (id: string | null) => void;
}

const Ctx = createContext<AppContext | null>(null);

/** Данные и действия приложения — для страниц (src/app/**\/page.tsx). */
export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp вне AppShell');
  return ctx;
}

type Status = 'loading' | 'guest' | 'ready' | 'error';

const EMPTY: AppData = { checklists: [], items: [], reminders: [], done: [] };

/** Разделы. Новые добавляются сюда по мере готовности (план — README). */
const SECTIONS = [
  { href: '/', label: 'Главная', icon: 'home' },
  { href: '/lists', label: 'Чек-листы', icon: 'list' },
  { href: '/reminders', label: 'Напоминания', icon: 'bell' },
] as const;

/**
 * Каркас LifeDashboard: вход (Login), загрузка данных одним запросом и
 * навигация — боковая панель на компьютере, нижняя на телефоне. Каркас живёт
 * в корневом layout и при переходах между разделами не пересоздаётся: данные
 * грузятся один раз, а страницы берут их из контекста (useApp).
 *
 * Правки применяются к экрану СРАЗУ (mutate: сначала меняем состояние, потом
 * идём на сервер) — галочка не должна ждать сети. Сервер отказал — говорим об
 * этом и перечитываем всё с сервера, чтобы экран не врал.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AppData>(EMPTY);
  const [openList, setOpenList] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const dayRef = useRef(localDay());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((message: string) => {
    setToastText(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), 4000);
  }, []);

  const reload = useCallback(async () => {
    try {
      const day = localDay();
      dayRef.current = day;
      setData(await api<AppData>(`state?day=${day}`));
      setStatus('ready');
    } catch (e) {
      setStatus((e as { status?: number }).status === 401 ? 'guest' : 'error');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Часы и смена суток: раз в 30 секунд обновляем «сейчас», а при переходе
  // через полночь или возвращении на вкладку на другой день — перечитываем
  // отметки (они на конкретный день).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d);
      if (localDay(d) !== dayRef.current) reload();
    };
    const timer = setInterval(tick, 30_000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  const mutate: Mutate = useCallback(
    (update, request) => {
      setData((d) => update(d));
      request().catch((e: Error) => {
        toast(e.message);
        reload();
      });
    },
    [reload, toast],
  );

  const logout = async () => {
    await api('auth/logout', 'POST').catch(() => undefined);
    setData(EMPTY);
    setStatus('guest');
  };

  if (status === 'loading') {
    return (
      <div aria-busy="true" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', color: 'var(--muted)' }}>
        Загружаем…
      </div>
    );
  }

  if (status === 'guest') {
    return (
      <Login
        onDone={() => {
          setStatus('loading');
          reload();
        }}
      />
    );
  }

  if (status === 'error') {
    return (
      <main className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '80vh', margin: '0 auto' }}>
        <div className="panel" style={{ maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 28 }}>
            Не удалось загрузить
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)' }}>Сервер не ответил. Проверьте интернет и попробуйте ещё раз.</p>
          <button className="btn btn-primary" type="button" onClick={() => { setStatus('loading'); reload(); }}>
            Попробовать ещё раз
          </button>
        </div>
      </main>
    );
  }

  const leftToday = data.reminders.filter((r) => appliesOn(r, now) && !data.done.includes(r.id)).length;
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const badge = (href: string) =>
    href === '/reminders' && leftToday > 0 ? (
      <span className="badge" aria-label={`${leftToday} на сегодня`}>
        {leftToday}
      </span>
    ) : null;
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <Ctx.Provider value={{ data, mutate, reload, toast, now, openList, setOpenList }}>
      <div className="shell">
        <aside className="side">
          <Link className="brand display" href="/">
            <span className="brand-mark">
              <Icon name="bag" size={20} strokeWidth={2} />
            </span>
            LifeDashboard
          </Link>
          <div className="side-date">
            {dayTitle(now)} · <span className="mono">{time}</span>
          </div>
          <nav aria-label="Разделы" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SECTIONS.map((s) => (
              <Link key={s.href} className="nav" href={s.href} aria-current={isActive(s.href) ? 'page' : undefined}>
                <Icon name={s.icon} />
                {s.label}
                {badge(s.href)}
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            <span className="who">{data.login ?? ''}</span>
            <ThemeToggle />
            {data.login && (
              <button className="icon-btn bare" type="button" onClick={logout} aria-label={`Выйти (${data.login})`} title={`Выйти (${data.login})`}>
                <Icon name="logout" />
              </button>
            )}
          </div>
        </aside>

        <header className="mtop">
          <Link className="brand-mark" href="/" aria-label="LifeDashboard — главная">
            <Icon name="bag" size={20} strokeWidth={2} />
          </Link>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{dayTitle(now)}</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {time}
            </div>
          </div>
          <ThemeToggle />
          {data.login && (
            <button className="icon-btn bare" type="button" onClick={logout} aria-label={`Выйти (${data.login})`}>
              <Icon name="logout" />
            </button>
          )}
        </header>

        <main className="page">{children}</main>

        <nav className="tabbar" aria-label="Разделы">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} aria-current={isActive(s.href) ? 'page' : undefined}>
              <Icon name={s.icon} size={22} />
              {s.label}
              {badge(s.href)}
            </Link>
          ))}
        </nav>
      </div>

      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </Ctx.Provider>
  );
}
