'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, apiDirect } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { convert, opEffect, type MoneyOp, type MoneyState } from '@/lib/money';
import { flush, onOutboxChange, outbox, type Queued } from '@/lib/offline';
import { registerOffline } from '@/lib/pushClient';
import type { MoneyDraft } from '@/lib/moneyAi';
import { Icon } from '../icons';
import Login from '../Login';
import DraftsSheet from './DraftsSheet';
import MoneyOnboarding from './MoneyOnboarding';
import OpSheet, { type OpDraft } from './OpSheet';
import ReceiptSheet from './ReceiptSheet';
import VoiceSheet from './VoiceSheet';

/** Что открыто поверх экрана. */
export type Sheet =
  | { type: 'op'; op: MoneyOp | OpDraft | null }
  | { type: 'drafts'; ops: MoneyDraft[]; said?: string }
  | { type: 'voice' }
  /** Новый чек с фото или позиции записанной операции. */
  | { type: 'receipt'; file?: File; op?: MoneyOp };

interface MoneyContext {
  data: MoneyState;
  reload: () => Promise<void>;
  month: string;
  setMonth: (m: string) => void;
  toast: (message: string) => void;
  /** Рублей за 1 единицу: курс ЦБ или свой; нет — undefined. */
  rateOf: (code: string) => number | undefined;
  /** В основную валюту; нет курса — null. */
  toBase: (minor: number, code: string) => number | null;
  /** Модуль не спрятан (Настройки → Что показывать). */
  shown: (module: string) => boolean;
  /** Открыть окно операции: новой (черновик) или существующей. */
  openOp: (op: MoneyOp | OpDraft | null) => void;
  open: (sheet: Sheet) => void;
  /** Включён ли ИИ (на сервере и в настройках) и модуль из него. */
  aiOn: (module?: 'voice' | 'receipts') => boolean;
  /**
   * Запись легла в другой месяц (чек от 24 сентября) — переключиться на него
   * и открыть «Операции», иначе её не видно. Вернёт название месяца или null.
   */
  reveal: (day: string) => string | null;
}

const Ctx = createContext<MoneyContext | null>(null);

export function useMoney(): MoneyContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMoney вне MoneyShell');
  return ctx;
}

type Status = 'loading' | 'guest' | 'forbidden' | 'ready' | 'error';

const TABS = [
  { href: '/money', label: 'Главная', icon: 'home' },
  { href: '/money/ops', label: 'Операции', icon: 'list' },
  { href: '/money/report', label: 'Отчёты', icon: 'chart' },
  { href: '/money/accounts', label: 'Счета', icon: 'wallet' },
  { href: '/money/settings', label: 'Ещё', icon: 'dots' },
];

/**
 * Оболочка «Денег»: вход (тот же, что у LifeDashboard), проверка доступа
 * (пока раздел тестовый), первый запуск, данные одним запросом и нижнее
 * меню. Отдельно от каркаса LifeDashboard — своё приложение со своей иконкой.
 */
export default function MoneyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<MoneyState | null>(null);
  const [month, setMonthState] = useState(() => localDay().slice(0, 7));
  const [toastText, setToastText] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monthRef = useRef(month);

  const toast = useCallback((message: string) => {
    setToastText(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastText(null), 4000);
  }, []);

  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [, setQueueTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      const fresh = await api<MoneyState>(`money/state?month=${monthRef.current}`);
      setData(fresh);
      setOfflineAt(null);
      setStatus('ready');
      if (monthRef.current === localDay().slice(0, 7)) saveCache(fresh);
    } catch (e) {
      if ((e as { offline?: boolean }).offline) {
        // Без сети — что уже на экране, иначе сохранённая копия.
        const cached = loadCache();
        setData((cur) => cur ?? cached?.state ?? null);
        setOfflineAt((at) => at ?? cached?.at ?? Date.now());
        setStatus((s) => (cached || s === 'ready' ? 'ready' : 'error'));
        return;
      }
      const code = (e as { status?: number }).status;
      setStatus(code === 401 ? 'guest' : code === 403 ? 'forbidden' : 'error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Отправить то, что записали без сети, и обновиться. */
  const sync = useCallback(async () => {
    if (!outbox().length || !navigator.onLine) return;
    const r = await flush(apiDirect);
    if (r.sent || r.rejected) await reload();
    if (r.sent) toast(`Отправлено без сети записанное: ${r.sent}`);
    if (r.rejected) toast(`Не принято сервером: ${r.rejected} — проверьте операции`);
  }, [reload, toast]);

  const setMonth = useCallback(
    (m: string) => {
      monthRef.current = m;
      setMonthState(m);
      reload();
    },
    [reload],
  );

  useEffect(() => {
    // Сервис-воркер LifeDashboard: страницы и файлы — из кэша без сети.
    registerOffline();
    // С экрана «Домой» открываемся сразу с последней копией, свежие данные — следом.
    const cached = monthRef.current === localDay().slice(0, 7) ? loadCache() : null;
    if (cached) {
      setData(cached.state);
      setStatus('ready');
    }
    reload().then(sync);
    // Вернулись в приложение — данные могли поменяться у семьи; появилась сеть — отправить очередь.
    const onVisible = () => !document.hidden && sync().then(reload);
    const onOnline = () => sync().then(reload);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const off = onOutboxChange(() => setQueueTick((n) => n + 1));
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      off();
    };
  }, [reload, sync]);

  if (status === 'loading') {
    return (
      <div aria-busy="true" className="m-center m-splash">
        <span className="m-splash-icon" aria-hidden="true">
          <Icon name="wallet" size={34} />
        </span>
        <span className="muted">Загружаем…</span>
      </div>
    );
  }
  if (status === 'guest') return <Login onDone={() => { setStatus('loading'); reload(); }} />;
  if (status === 'forbidden' || status === 'error' || !data) {
    return (
      <main className="m-center">
        <div className="m-card" style={{ maxWidth: 420, gap: 12 }}>
          <h1 className="display m-h1">{status === 'forbidden' ? 'Пока в тесте' : 'Не удалось загрузить'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {status === 'forbidden' ? '«Деньги» открыты только тем, кто тестирует. Попросите добавить вас в список.' : 'Сервер не ответил. Проверьте интернет и попробуйте ещё раз.'}
          </p>
          {status === 'error' ? (
            <button className="btn btn-primary" type="button" onClick={() => { setStatus('loading'); reload(); }}>
              Попробовать ещё раз
            </button>
          ) : (
            <a className="btn btn-ghost" href="/task">
              Открыть LifeDashboard
            </a>
          )}
        </div>
      </main>
    );
  }
  if (!data.settings) return <MoneyOnboarding onDone={reload} />;

  const queued = outbox().filter((q) => q.path.startsWith('money/'));
  const shownData = withPending(data, queued);
  const rateOf = (code: string) => (code === 'RUB' ? 1 : data.rates[code] ?? data.user_rates[code]);
  const base = data.settings.base_currency;
  const value: MoneyContext = {
    data: shownData,
    reload,
    month,
    setMonth,
    toast,
    rateOf,
    toBase: (minor, code) => convert(minor, code, base, rateOf),
    shown: (m) => !data.settings!.hidden.includes(m),
    openOp: (op) => setSheet({ type: 'op', op }),
    reveal: (day) => {
      const m = day.slice(0, 7);
      // Главная всегда про текущий месяц, «Операции» — про выбранный.
      const visible = pathname.startsWith('/money/ops') ? monthRef.current : localDay().slice(0, 7);
      if (m === visible) return null;
      setMonth(m);
      if (!pathname.startsWith('/money/ops')) router.push('/money/ops');
      return new Date(`${m}-15T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
    },
    open: setSheet,
    aiOn: (m) => data.ai && (m ? !data.settings!.hidden.includes(m) : !data.settings!.hidden.includes('ai')),
  };
  const close = () => setSheet(null);
  const active = (href: string) => (href === '/money' ? pathname === '/money' : pathname.startsWith(href));

  return (
    <Ctx.Provider value={value}>
      <div className="m-app">
        {(offlineAt || queued.length > 0) && (
          <div className="m-offline" role="status">
            {offlineAt ? `Нет сети — данные от ${new Date(offlineAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Сеть есть'}
            {queued.length > 0 && ` · ждут отправки: ${queued.length}`}
          </div>
        )}
        {children}
        <nav className="m-tabbar" aria-label="Разделы">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t.href) ? 'page' : undefined}>
              <Icon name={t.icon} size={22} />
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {sheet?.type === 'op' && <OpSheet op={sheet.op} onClose={close} />}
      {sheet?.type === 'drafts' && <DraftsSheet ops={sheet.ops} said={sheet.said} onClose={close} />}
      {sheet?.type === 'voice' && <VoiceSheet onClose={close} />}
      {sheet?.type === 'receipt' && <ReceiptSheet file={sheet.file} op={sheet.op} onClose={close} />}
      {toastText && (
        <div className="toast m-toast" role="status">
          <span>{toastText}</span>
        </div>
      )}
    </Ctx.Provider>
  );
}

const CACHE = 'money:state';

/** Копия данных текущего месяца — чтобы открыться без сети. Стирается вместе с аккаунтом. */
function saveCache(state: MoneyState) {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ v: 1, at: Date.now(), state }));
  } catch {
    /* место кончилось — без офлайна, но работаем */
  }
}
function loadCache(): { at: number; state: MoneyState } | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as { v: number; at: number; state: MoneyState } | null;
    return c?.v === 1 ? c : null;
  } catch {
    return null;
  }
}

/**
 * Операции, записанные без сети, видны сразу: в списке (с временным id) и в
 * остатках счетов. Когда сеть вернётся, их отправит очередь, и данные с
 * сервера заменят эти черновые.
 */
function withPending(data: MoneyState, queued: Queued[]): MoneyState {
  const adds = queued.filter((q) => q.path === 'money/ops' && q.method === 'POST' && q.tempId);
  if (!adds.length) return data;
  const ops: MoneyOp[] = [];
  for (const q of adds) {
    const b = (q.body ?? {}) as Record<string, unknown>;
    const acc = data.accounts.find((a) => a.id === b.account_id);
    if (!acc || typeof b.day !== 'string' || !b.day.startsWith(data.month)) continue;
    const to = data.accounts.find((a) => a.id === b.to_account_id);
    const kind = b.kind as MoneyOp['kind'];
    ops.push({
      id: q.tempId!,
      kind,
      day: b.day,
      account_id: acc.id,
      amount_minor: Number(b.amount_minor) || 0,
      currency: acc.currency,
      to_account_id: to?.id ?? null,
      to_amount_minor: kind === 'transfer' ? Number(b.amount_minor) || 0 : b.to_amount_minor ? Number(b.to_amount_minor) : null,
      to_currency: to?.currency ?? null,
      orig_amount_minor: b.orig_amount_minor ? Number(b.orig_amount_minor) : null,
      orig_currency: typeof b.orig_currency === 'string' ? b.orig_currency : null,
      category_id: typeof b.category_id === 'string' ? b.category_id : null,
      category_name: data.categories.find((c) => c.id === b.category_id)?.name ?? null,
      payee: typeof b.payee === 'string' ? b.payee : null,
      note: 'ждёт отправки',
      source: typeof b.source === 'string' ? b.source : 'manual',
      debt_id: null,
      mine: true,
      author: null,
      items_count: Array.isArray(b.items) ? b.items.length : 0,
    });
  }
  return {
    ...data,
    ops: [...ops, ...data.ops].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
    accounts: data.accounts.map((a) => ({ ...a, balance_minor: a.balance_minor + ops.reduce((s, o) => s + opEffect(o, a.id), 0) })),
  };
}
