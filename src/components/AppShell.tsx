'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, apiDirect, OfflineError } from '@/lib/api';
import { guessDept } from '@/lib/kitchenSeed';
import { registerOffline } from '@/lib/pushClient';
import { clearOffline, flush, loadState, onOutboxChange, outbox, saveState, type Queued } from '@/lib/offline';
import { dayTitle, localDay } from '@/lib/dates';
import type { Product, Recipe } from '@/lib/kitchen';
import type { FridgeItem } from '@/lib/fridge';
import { arrange, HELP, HOME, type NavPref, type Section } from '@/lib/nav';
import { parseHub, type HubPrefs, type HubUsage } from '@/lib/hub';
import { contextOf, dashBar, hubBar, MONEY_BAR, slideClass, takeSlide, MONEY_HOME } from '@/lib/superapp';
import type { Task } from '@/lib/tasks';
import type { Vacations } from '@/lib/vacations';
import { leftToday, timeline } from '@/lib/timeline';
import type { Exercise, Workout, WorkoutTemplate } from '@/lib/workouts';
import type { Checklist, ChecklistItem, Note, Reminder, Snooze } from '@/lib/types';
import { Icon } from './icons';
import Login from './Login';
import Onboarding from './Onboarding';
import SearchDialog from './SearchDialog';
import Tour from './Tour';
import ThemeToggle from './ThemeToggle';
import PhoneBar from './PhoneBar';
import Composer, { type ComposerStart } from './Composer';
import SkipLink from './SkipLink';

export interface AppData {
  checklists: Checklist[];
  items: ChecklistItem[];
  reminders: Reminder[];
  /** Отметки «сделано» СЕГОДНЯ — ключи `${id}@${время}` (src/lib/occurrences.ts). */
  done: string[];
  /** Отложенные сегодня. */
  snoozed: Snooze[];
  /** Задачи без напоминания: открытые и закрытые сегодня. */
  tasks: Task[];
  /** id задач, отмеченных сегодня. */
  tasksDoneToday: string[];
  /** Свои метки — по порядку (src/server/tagStore.ts). */
  tags: string[];
  notes: Note[];
  kitchen: { products: Product[]; recipes: Recipe[]; pantry: string[]; shopping_id: string | null; fridge: FridgeItem[] };
  gym: { workouts: Workout[]; exercises: Exercise[]; templates: WorkoutTemplate[] };
  settings: { city: string | null; lat: number | null; lon: number | null; tz: string | null; deadline_time: string; summary_time: string | null; nav: NavPref[] | null; calendar_token: string | null; onboarded: boolean; quiet_from: string | null; quiet_to: string | null; review_time: string | null; tour_seen: string[]; task_hidden: string[]; hub?: HubPrefs; hub_usage?: HubUsage };
  household: { id: string; name: string; members: { login: string; me: boolean }[] } | null;
  /** Отпуска и сколько дней положено в год (src/lib/vacations.ts). */
  vacations: Vacations;
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
  /** Сообщение внизу; undo — кнопка «Отменить» (держим подольше, 6 с). */
  toast: (message: string, undo?: () => void) => void;
  /** «Сейчас», обновляется раз в 30 секунд. */
  now: Date;
  /** Какой чек-лист открыт — общий, чтобы напоминание могло открыть свой. */
  openList: string | null;
  setOpenList: (id: string | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppContext | null>(null);

/** Данные и действия приложения — для страниц (src/app/**\/page.tsx). */
/** Вне каркаса LifeDashboard (в «Деньгах») — null: поиск работает и там. */
export function useAppMaybe(): AppContext | null {
  return useContext(Ctx);
}

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
  tags: [],
  notes: [],
  kitchen: { products: [], recipes: [], pantry: [], shopping_id: null, fridge: [] },
  gym: { workouts: [], exercises: [], templates: [] },
  settings: { city: null, lat: null, lon: null, tz: null, deadline_time: '09:00', summary_time: null, nav: null, calendar_token: null, onboarded: true, quiet_from: '23:00', quiet_to: '07:00', review_time: null, tour_seen: [], task_hidden: [] },
  household: null,
  vacations: { list: [], allowance: null, family: [] },
};

/** Показать созданное без сети, пока оно в очереди (настоящий id придёт позже). */
function withQueued(d: AppData, q: Queued): AppData {
  const b = (q.body ?? {}) as Record<string, unknown>;
  if (q.path === 'tasks' && q.tempId) {
    const t: Task = { id: q.tempId, title: String(b.title ?? ''), note: null, tags: (b.tags as string[]) ?? [], priority: (b.priority as Task['priority']) ?? 0, checklist_id: null, done_at: null, household_id: null, author: null, assignee: null, done_by: null };
    return { ...d, tasks: [...d.tasks, t] };
  }
  if (q.path === 'reminders' && q.tempId) {
    const r = { id: q.tempId, title: String(b.title ?? ''), times: (b.times as string[]) ?? [], rule: b.rule as Reminder['rule'], checklist_id: null, last_done: null, nag: null, tags: (b.tags as string[]) ?? [], priority: (b.priority as Reminder['priority']) ?? 0, note: null, household_id: null, assignee: null, author: null };
    return { ...d, reminders: [...d.reminders, r] };
  }
  if (q.path === 'kitchen/shopping' && d.kitchen.shopping_id && Array.isArray(b.items)) {
    const added = (b.items as { name?: string }[])
      .filter((i) => i.name)
      .map((i, k) => ({ id: `tmp-${q.id}-${k}`, checklist_id: d.kitchen.shopping_id!, title: i.name!, group_name: guessDept(i.name!), note: null, done: false, position: Date.now() + k }));
    return { ...d, items: [...d.items, ...added] };
  }
  return d;
}

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
/** «Вс, 4 октября» — помещается в боковую панель одной строкой. */
function shortDay(d: Date): string {
  const s = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * «Деньги» (/money) — отдельное приложение со своей оболочкой
 * (src/components/money/MoneyShell.tsx): каркас LifeDashboard и его данные им
 * не нужны.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/money' || pathname.startsWith('/money/')) return <>{children}</>;
  return <LdShell>{children}</LdShell>;
}

// Последние данные — на уровне модуля: при переходе в «Деньги» оболочка
// выгружается, и без этого возврат на главную снова ждал бы сервер.
// С ними экран сразу на месте, а свежие данные подтягиваются фоном.
let memo: AppData | null = null;

function LdShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // «+» на главной и окно «Записать».
  const [plusOpen, setPlusOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerStart | null>(null);
  useEffect(() => setPlusOpen(false), [pathname]);
  // /lists?list=<id> — открыть чек-лист: так ведёт поиск из «Денег», где выбора чек-листа нет.
  useEffect(() => {
    const list = pathname === '/lists' ? new URLSearchParams(window.location.search).get('list') : null;
    if (!list) return;
    setOpenList(list);
    router.replace('/lists');
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // Откуда приехал экран — считаем один раз на адрес.
  const slide = useRef<{ path: string; cls: string } | null>(null);
  const [status, setStatus] = useState<Status>(memo ? 'ready' : 'loading');
  const [data, setData] = useState<AppData>(memo ?? EMPTY);
  useEffect(() => {
    if (status === 'ready') memo = data;
  }, [status, data]);
  const [openList, setOpenList] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [searching, setSearching] = useState(false);
  const dayRef = useRef(localDay());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const undoRef = useRef<(() => void) | null>(null);

  /** Убрать сообщение через ms; пока на нём мышь или фокус — не убираем. */
  const hideToastIn = useCallback((ms: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToastText(null);
      undoRef.current = null;
    }, ms);
  }, []);
  const holdToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  };

  const toast = useCallback(
    (message: string, undo?: () => void) => {
      undoRef.current = undo ?? null;
      setToastUndo(() => undo ?? null);
      setToastText(message);
      hideToastIn(undo ? 8000 : 4000);
    },
    [hideToastIn],
  );

  const runUndo = useCallback(() => {
    const undo = undoRef.current;
    if (!undo) return;
    undoRef.current = null;
    undo();
    setToastText(null);
  }, []);

  // Ctrl+Z — «Отменить» последнего сообщения, пока оно на экране. В полях
  // ввода не перехватываем: там Ctrl+Z отменяет набранный текст.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || (e.key.toLowerCase() !== 'z' && e.code !== 'KeyZ')) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!undoRef.current) return;
      e.preventDefault();
      runUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runUndo]);

  // Без сети: показываем сохранённые данные, изменения копятся в очереди
  // (src/lib/offline.ts) и уходят, когда сеть вернётся.
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const statusRef = useRef<Status>('loading');
  statusRef.current = status;
  const syncing = useRef(false);
  const loadedAt = useRef(0);

  const reload = useCallback(async () => {
    try {
      const day = localDay();
      dayRef.current = day;
      const fresh = await api<AppData>(`state?day=${day}`);
      loadedAt.current = Date.now();
      setData(fresh);
      saveState(fresh.login, fresh);
      setOffline(false);
      setPending(outbox().length);
      setStatus('ready');
    } catch (e) {
      if (e instanceof OfflineError) {
        setOffline(true);
        // Уже открыто — оставляем то, что на экране (там и несохранённое).
        if (statusRef.current === 'ready') return;
        const cached = loadState<AppData>();
        if (cached) {
          setData({ ...EMPTY, ...cached.state });
          setStatus('ready');
          return;
        }
        setStatus('error');
        return;
      }
      if ((e as { status?: number }).status === 401) {
        memo = null;
        setStatus('guest');
        return;
      }
      // Экран уже показан из памяти — оставляем его, не пугаем ошибкой.
      if (statusRef.current !== 'ready') setStatus('error');
    }
  }, []);

  /** Отправить очередь; что-то ушло — перечитать данные с сервера. */
  const sync = useCallback(async () => {
    if (syncing.current || !outbox().length) return;
    syncing.current = true;
    try {
      const r = await flush(apiDirect);
      setPending(outbox().length);
      if (r.rejected) toast(`Не удалось сохранить изменений: ${r.rejected} — сервер их не принял.`);
      if (r.sent || r.rejected) await reload();
    } finally {
      syncing.current = false;
    }
  }, [reload, toast]);

  useEffect(() => {
    registerOffline();
    reload().then(sync);
  }, [reload, sync]);

  useEffect(() => {
    setPending(outbox().length);
    const off = onOutboxChange(() => setPending(outbox().length));
    // Очередь могли изменить в другой вкладке.
    const storage = (e: StorageEvent) => e.key === 'ld:outbox' && setPending(outbox().length);
    window.addEventListener('storage', storage);
    const online = () => reload().then(sync);
    const wentOffline = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', wentOffline);
    // Созданное без сети — сразу на экран, с временным id.
    const queued = (e: Event) => setData((d) => withQueued(d, (e as CustomEvent<Queued>).detail));
    window.addEventListener('ld:queued', queued);
    // Сеть могла вернуться без события — пробуем раз в полминуты.
    const t = setInterval(() => outbox().length && sync(), 30_000);
    return () => {
      off();
      window.removeEventListener('storage', storage);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', wentOffline);
      window.removeEventListener('ld:queued', queued);
      clearInterval(t);
    };
  }, [reload, sync]);

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
    // Вернулись в приложение (с другого экрана, из фона) — данные могли
    // поменяться на другом устройстве или у семьи: перечитываем, если
    // последнему чтению больше минуты.
    const onVisible = () => {
      if (document.hidden) return;
      tick();
      if (Date.now() - loadedAt.current > 60_000) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  // Число на иконке приложения (экран «Домой»): сколько осталось на сегодня.
  useEffect(() => {
    if (status !== 'ready') return;
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const n = leftToday(timeline(data.tasks, data.reminders, localDay(now), new Set(data.done), data.snoozed));
    (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined);
  }, [status, data, now]);

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
    clearOffline();
    memo = null;
    setData(EMPTY);
    setStatus('guest');
  };

  if (status === 'loading') {
    return (
      <div role="status" aria-busy="true" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', color: 'var(--muted)' }}>
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
          <h1 className="display" style={{ margin: 0, fontSize: 'calc(28px * var(--fs))' }}>
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

  // «Дела»: сколько осталось на сегодня — просроченное, дела и напоминания дня.
  const left = leftToday(timeline(data.tasks, data.reminders, localDay(now), new Set(data.done), data.snoozed));
  const nav = arrange(data.settings.nav);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const ctx = contextOf(pathname);
  const barOf = (c: typeof ctx) => (c === 'hub' ? hubBar(parseHub(data.settings.hub)) : c === 'money' ? MONEY_BAR : dashBar(nav.phone));
  if (slide.current?.path !== pathname) slide.current = { path: pathname, cls: slideClass(takeSlide(pathname, barOf)) };
  const counts: Record<string, [number, string]> = {
    '/tasks': [left, 'на сегодня'],
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
        <SkipLink />
        <aside className="side">
          <Link className="brand display" href="/">
            <span className="brand-mark">
              <Icon name="bag" size={20} strokeWidth={2} />
            </span>
            LifeDashboard
          </Link>
          <div className="side-date">
            <span>{shortDay(now)}</span>
            <span className="mono">{time}</span>
          </div>
          <button className="searchbtn" type="button" onClick={() => setSearching(true)}>
            <Icon name="search" size={18} />
            <span style={{ flex: 1 }}>Поиск</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav aria-label="Разделы" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {([HOME, ...nav.visible, MONEY_HOME, ...HELP] as Section[]).map((s) => (
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

        {/* На главной супер-аппа своя шапка с датой, а настройки — в нижнем меню. */}
        {pathname !== '/' && (
          <header className="mtop">
            <Link href="/" style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 'calc(15px * var(--fs))', color: 'inherit', textDecoration: 'none' }}>
              {dayTitle(now)}
            </Link>
            <button className="icon-btn bare" type="button" onClick={() => setSearching(true)} aria-label="Поиск">
              <Icon name="search" />
            </button>
            {ctx !== 'hub' && (
              <Link className="icon-btn bare" href="/settings" aria-label="Настройки (там же тема и выход)" aria-current={isActive('/settings') ? 'page' : undefined}>
                <Icon name="settings" />
              </Link>
            )}
          </header>
        )}

        {(offline || pending > 0) && (
          <div className="offline-bar" role="status">
            <Icon name={offline ? 'cloud' : 'repeat'} size={16} />
            {offline ? 'Нет сети — показываю сохранённое' : 'Отправляю изменения…'}
            {pending > 0 && ` · ждут отправки: ${pending}`}
          </div>
        )}
        <main key={pathname} id="main" className={`page ${slide.current.cls}`}>
          {children}
        </main>

        <PhoneBar
          ctx={ctx}
          items={barOf(ctx)}
          badges={{ '/tasks': left }}
          plus={
            ctx === 'hub'
              ? {
                  open: plusOpen,
                  setOpen: setPlusOpen,
                  onSubmit: (text) => setComposer({ text }),
                  onVoice: () => setComposer({ voice: true }),
                }
              : undefined
          }
        />
      </div>
      {composer && (
        <Composer
          start={composer}
          onClose={(saved) => {
            setComposer(null);
            if (saved) setPlusOpen(false);
          }}
          onOpenMoney={() => router.push('/money')}
        />
      )}

      {searching && <SearchDialog onClose={() => setSearching(false)} />}
      <Tour />

      {/* Знакомство — только совсем новым: не прошли и ничего ещё не завели. */}
      {!data.settings.onboarded && data.tasks.length + data.reminders.length + data.checklists.length + data.notes.length === 0 && <Onboarding />}

      {/* Область для диктора есть всегда: если создать её вместе с текстом,
          NVDA и VoiceOver часто его не прочтут. */}
      <div className="sr-only" role="status" aria-live="polite">
        {toastText ? (toastUndo ? `${toastText}. Отменить — Ctrl+Z` : toastText) : ''}
      </div>
      {toastText && (
        <div className="toast" onMouseEnter={holdToast} onMouseLeave={() => hideToastIn(4000)} onFocus={holdToast} onBlur={() => hideToastIn(4000)}>
          <span aria-hidden="true">{toastText}</span>
          {toastUndo && (
            <button type="button" className="toast-undo" aria-keyshortcuts="Control+Z" title="Ctrl+Z" onClick={runUndo}>
              Отменить
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
