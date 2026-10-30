'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { convert, type MoneyOp, type MoneyState } from '@/lib/money';
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

  const reload = useCallback(async () => {
    try {
      const fresh = await api<MoneyState>(`money/state?month=${monthRef.current}`);
      setData(fresh);
      setStatus('ready');
    } catch (e) {
      const code = (e as { status?: number }).status;
      setStatus(code === 401 ? 'guest' : code === 403 ? 'forbidden' : 'error');
    }
  }, []);

  const setMonth = useCallback(
    (m: string) => {
      monthRef.current = m;
      setMonthState(m);
      reload();
    },
    [reload],
  );

  useEffect(() => {
    reload();
    // Вернулись в приложение — данные могли поменяться у семьи.
    const onVisible = () => !document.hidden && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  if (status === 'loading') {
    return (
      <div aria-busy="true" className="m-center muted">
        Загружаем…
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

  const rateOf = (code: string) => (code === 'RUB' ? 1 : data.rates[code] ?? data.user_rates[code]);
  const base = data.settings.base_currency;
  const value: MoneyContext = {
    data,
    reload,
    month,
    setMonth,
    toast,
    rateOf,
    toBase: (minor, code) => convert(minor, code, base, rateOf),
    shown: (m) => !data.settings!.hidden.includes(m),
    openOp: (op) => setSheet({ type: 'op', op }),
    open: setSheet,
    aiOn: (m) => data.ai && (m ? !data.settings!.hidden.includes(m) : !data.settings!.hidden.includes('ai')),
  };
  const close = () => setSheet(null);
  const active = (href: string) => (href === '/money' ? pathname === '/money' : pathname.startsWith(href));

  return (
    <Ctx.Provider value={value}>
      <div className="m-app">
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
