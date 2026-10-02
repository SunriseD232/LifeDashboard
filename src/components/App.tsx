'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { appliesOn, dayTitle, localDay } from '@/lib/dates';
import type { Checklist, ChecklistItem, Reminder } from '@/lib/types';
import Checklists from './Checklists';
import Login from './Login';
import { Icon } from './icons';
import Reminders from './Reminders';

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

type Tab = 'lists' | 'reminders';
type Status = 'loading' | 'guest' | 'ready' | 'error';

function tabFromHash(): Tab {
  return typeof window !== 'undefined' && window.location.hash === '#reminders' ? 'reminders' : 'lists';
}

/**
 * Каркас LifeDashboard: загрузка данных одним запросом, свой вход (Login),
 * две вкладки вверху — «Чек-листы» и «Напоминания».
 *
 * Правки применяются к экрану СРАЗУ (mutate: сначала меняем состояние, потом
 * идём на сервер) — галочка не должна ждать сети. Сервер отказал — говорим об
 * этом и перечитываем всё с сервера, чтобы экран не врал.
 */
export default function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AppData>({ checklists: [], items: [], reminders: [], done: [] });
  const [tab, setTab] = useState<Tab>('lists');
  const [openList, setOpenList] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const dayRef = useRef(localDay());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const day = localDay();
      dayRef.current = day;
      const next = await api<AppData>(`state?day=${day}`);
      setData(next);
      setStatus('ready');
    } catch (e) {
      const err = e as Error & { status?: number };
      setStatus(err.status === 401 ? 'guest' : 'error');
    }
  }, []);

  useEffect(() => {
    setTab(tabFromHash());
    load();
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  // Часы и смена суток: раз в 30 секунд обновляем «сейчас», а при переходе
  // через полночь или возвращении на вкладку на другой день — перечитываем
  // отметки (они на конкретный день).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d);
      if (localDay(d) !== dayRef.current) load();
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
  }, [load]);

  const mutate: Mutate = useCallback(
    (update, request) => {
      setData((d) => update(d));
      request().catch((e: Error) => {
        showToast(e.message);
        load();
      });
    },
    [load, showToast],
  );

  const goTab = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', t === 'reminders' ? '#reminders' : '#lists');
  };

  const openChecklist = (id: string) => {
    setOpenList(id);
    goTab('lists');
  };

  const logout = async () => {
    await api('auth/logout', 'POST').catch(() => undefined);
    setData({ checklists: [], items: [], reminders: [], done: [] });
    setStatus('guest');
  };

  const leftToday = data.reminders.filter((r) => appliesOn(r, now) && !data.done.includes(r.id)).length;

  if (status === 'loading') {
    return (
      <div className="page" aria-busy="true" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', color: 'var(--muted)' }}>
        Загружаем ваши списки…
      </div>
    );
  }

  if (status === 'guest') {
    return (
      <Login
        onDone={() => {
          setStatus('loading');
          load();
        }}
      />
    );
  }

  if (status === 'error') {
    return (
      <main className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '80vh' }}>
        <div className="panel" style={{ maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
            <Icon name="bag" size={26} strokeWidth={2} />
          </span>
          <h1 className="display" style={{ margin: 0, fontSize: 28 }}>
            Не удалось загрузить
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)' }}>Сервер не ответил. Проверьте интернет и попробуйте ещё раз.</p>
          <button className="btn btn-primary" type="button" onClick={() => { setStatus('loading'); load(); }}>
            Попробовать ещё раз
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <a className="brand display" href="/task" aria-label="LifeDashboard">
          <span className="brand-mark">
            <Icon name="bag" size={20} strokeWidth={2} />
          </span>
          <span className="brand-name">LifeDashboard</span>
        </a>
        <nav className="tabs" aria-label="Разделы">
          <a
            className="tab"
            href="#lists"
            aria-current={tab === 'lists' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              goTab('lists');
            }}
          >
            <Icon name="list" />
            Чек-листы
          </a>
          <a
            className="tab"
            href="#reminders"
            aria-current={tab === 'reminders' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              goTab('reminders');
            }}
          >
            <Icon name="bell" />
            Напоминания
            {leftToday > 0 && (
              <span className="badge" aria-label={`${leftToday} на сегодня`}>
                {leftToday}
                <span className="badge-word"> сегодня</span>
              </span>
            )}
          </a>
        </nav>
        <div className="today">
          <div style={{ fontWeight: 600 }}>{dayTitle(now)}</div>
          <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
            {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        {data.login && (
          <button className="icon-btn bare" type="button" onClick={logout} aria-label={`Выйти (${data.login})`} title={`Выйти (${data.login})`}>
            <Icon name="logout" />
          </button>
        )}
      </header>

      <main className="page">
        {tab === 'lists' ? (
          <Checklists data={data} mutate={mutate} reload={load} openId={openList} setOpenId={setOpenList} toast={showToast} />
        ) : (
          <Reminders data={data} mutate={mutate} reload={load} now={now} onOpenChecklist={openChecklist} toast={showToast} />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
