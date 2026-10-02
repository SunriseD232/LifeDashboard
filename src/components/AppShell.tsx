'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { dayTitle, localDay } from '@/lib/dates';
import { occurrencesOn } from '@/lib/occurrences';
import type { Product, Recipe } from '@/lib/kitchen';
import { arrange, HELP, HOME, type NavPref } from '@/lib/nav';
import { bucket, type Task } from '@/lib/tasks';
import type { Exercise, Workout, WorkoutTemplate } from '@/lib/workouts';
import type { Checklist, ChecklistItem, Note, Reminder, Snooze } from '@/lib/types';
import { Icon } from './icons';
import Login from './Login';
import SearchDialog from './SearchDialog';
import ThemeToggle from './ThemeToggle';

export interface AppData {
  checklists: Checklist[];
  items: ChecklistItem[];
  reminders: Reminder[];
  /** Отметки «сделано» СЕГОДНЯ — ключи `${id}@${время}` (src/lib/occurrences.ts). */
  done: string[];
  /** Отложенные сегодня. */
  snoozed: Snooze[];
  /** Открытые дела и закрытые сегодня. */
  tasks: Task[];
  /** id дел, отмеченных сегодня (в том числе повторяющихся, переехавших дальше). */
  tasksDoneToday: string[];
  notes: Note[];
  kitchen: { products: Product[]; recipes: Recipe[]; pantry: string[]; shopping_id: string | null };
  gym: { workouts: Workout[]; exercises: Exercise[]; templates: WorkoutTemplate[] };
  settings: { city: string | null; lat: number | null; lon: number | null; tz: string | null; deadline_time: string; summary_time: string | null; nav: NavPref[] | null; calendar_token: string | null };
  household: { id: string; name: string; members: { login: string; me: boolean }[] } | null;
  /** Логин вошедшего (в next dev с LD_DEV_USER — null). */
  login?: string | null;
  /** Подключён ли ИИ (src/server/ai.ts) — иначе ИИ-кнопок не показываем. */
  ai?: boolean;
  /** Разбирает обращения в поддержку. */
  admin?: boolean;
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
  logout: () => Promise<void>;
}

const Ctx = createContext<AppContext | null>(null);

/** Данные и действия приложения — для страниц (src/app/**\/page.tsx). */
export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp вне AppShell');
  return ctx;
}

type Status = 'loading' | 'guest' | 'ready' | 'error';

const EMPTY: AppData = {
  checklists: [],
  items: [],
  reminders: [],
  done: [],
  snoozed: [],
  tasks: [],
  tasksDoneToday: [],
  notes: [],
  kitchen: { products: [], recipes: [], pantry: [], shopping_id: null },
  gym: { workouts: [], exercises: [], templates: [] },
  settings: { city: null, lat: null, lon: null, tz: null, deadline_time: '09:00', summary_time: null, nav: null, calendar_token: null },
  household: null,
};

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
  const [searching, setSearching] = useState(false);
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

  // Ctrl K / ⌘K — поиск отовсюду.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const leftToday = occurrencesOn(data.reminders, localDay(now), new Set(data.done)).filter((o) => !o.done).length;
  const nav = arrange(data.settings.nav);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const urgent = data.tasks.filter((t) => bucket(t, localDay(now)) === 'urgent').length;
  const counts: Record<string, [number, string]> = {
    '/reminders': [leftToday, 'на сегодня'],
    '/tasks': [urgent, 'срочных'],
  };
  const badge = (href: string) => {
    const [n, what] = counts[href] ?? [0, ''];
    return n > 0 ? (
      <span className="badge" aria-label={`${n} ${what}`}>
        {n}
      </span>
    ) : null;
  };
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <Ctx.Provider value={{ data, mutate, reload, toast, now, openList, setOpenList, logout }}>
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
          <button className="searchbtn" type="button" onClick={() => setSearching(true)}>
            <Icon name="search" size={18} />
            <span style={{ flex: 1 }}>Поиск</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav aria-label="Разделы" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[HOME, ...nav.visible, ...HELP].map((s) => (
              <Fragment key={s.href}>
                {s.group && (!nav.custom || HELP.includes(s)) && <div className="nav-sep">{s.group}</div>}
                <Link className="nav" href={s.href} aria-current={isActive(s.href) ? 'page' : undefined}>
                  <Icon name={s.icon} />
                  {s.label}
                  {badge(s.href)}
                </Link>
              </Fragment>
            ))}
          </nav>
          <div className="side-foot">
            <span className="who">{data.login ?? ''}</span>
            <Link className="icon-btn bare" href="/settings" aria-label="Настройки" title="Настройки" aria-current={isActive('/settings') ? 'page' : undefined}>
              <Icon name="settings" />
            </Link>
            <ThemeToggle />
            {data.login && (
              <button className="icon-btn bare" type="button" onClick={logout} aria-label={`Выйти (${data.login})`} title={`Выйти (${data.login})`}>
                <Icon name="logout" />
              </button>
            )}
          </div>
        </aside>

        <header className="mtop">
          <Link href="/" style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 15, color: 'inherit', textDecoration: 'none' }}>
            {dayTitle(now)}
          </Link>
          <button className="icon-btn bare" type="button" onClick={() => setSearching(true)} aria-label="Поиск">
            <Icon name="search" />
          </button>
          <Link className="icon-btn bare" href="/settings" aria-label="Настройки (там же тема и выход)" aria-current={isActive('/settings') ? 'page' : undefined}>
            <Icon name="settings" />
          </Link>
        </header>

        <main className="page">{children}</main>

        <nav className="tabbar" aria-label="Разделы">
          {[HOME, ...nav.phone].map((s) => (
            <Link key={s.href} href={s.href} aria-current={isActive(s.href) ? 'page' : undefined}>
              <Icon name={s.icon} size={22} />
              {s.short ?? s.label}
              {badge(s.href)}
            </Link>
          ))}
          <Link href="/more" aria-current={isActive('/more') || [...nav.visible, ...HELP].some((s) => !nav.phone.includes(s) && isActive(s.href)) ? 'page' : undefined}>
            <Icon name="dots" size={22} />
            Ещё
          </Link>
        </nav>
      </div>

      {searching && <SearchDialog onClose={() => setSearching(false)} />}

      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </Ctx.Provider>
  );
}
