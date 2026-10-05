'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { disablePush, enablePush, isIos, pushState, type PushState } from '@/lib/pushClient';
import { Icon } from './icons';

/**
 * «Уведомления на телефон» — включить, проверить, выключить push на этом
 * устройстве. Подписка у каждого устройства своя: включил на телефоне — на
 * телефон и придёт, компьютер её не трогает.
 */
export default function PushPanel({ toast }: { toast: (m: string) => void }) {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    setPhone(/Android|iPhone|iPad|iPod/.test(navigator.userAgent) || isIos());
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);

  const where = phone ? 'на этом телефоне' : 'на этом устройстве';

  const run = async (fn: () => Promise<PushState>, okMessage?: string) => {
    setBusy(true);
    try {
      const next = await fn();
      setState(next);
      if (next === 'on' && okMessage) toast(okMessage);
      if (next === 'denied') toast('Уведомления запрещены в настройках браузера для media-watch.ru.');
    } catch (e) {
      toast((e as Error).message || 'Не получилось включить уведомления.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading' || state === 'unsupported') {
    // Браузер без push (редкость) — не шумим: напоминания всё равно видны
    // во вкладке.
    return null;
  }

  return (
    <div className="panel" style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ color: state === 'on' ? 'var(--accent-ink)' : 'var(--muted)', paddingTop: 2 }}>
        <Icon name="bell" />
      </span>
      <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: 'calc(14px * var(--fs))' }}>
        {state === 'on' && (
          <>
            <strong>Уведомления включены {where}.</strong>
            <div style={{ color: 'var(--muted)' }}>Придут в момент дела, даже если LifeDashboard закрыт.</div>
          </>
        )}
        {state === 'off' && (
          <>
            <strong>Уведомления {where}</strong>
            <div style={{ color: 'var(--muted)' }}>Пришлём напоминание в момент дела, даже если LifeDashboard закрыт.</div>
          </>
        )}
        {state === 'denied' && (
          <>
            <strong>Уведомления запрещены</strong>
            <div style={{ color: 'var(--muted)' }}>
              Разрешите их для media-watch.ru в настройках браузера (значок замка у адреса → Уведомления), затем обновите
              страницу.
            </div>
          </>
        )}
        {state === 'ios-install' && (
          <>
            <strong>На iPhone уведомления — через экран «Домой»</strong>
            <ol style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--muted)' }}>
              <li>Нажмите «Поделиться» внизу Safari.</li>
              <li>Выберите «На экран «Домой»» и добавьте LifeDashboard.</li>
              <li>Откройте LifeDashboard с экрана «Домой» и включите уведомления здесь.</li>
            </ol>
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>Так требует Apple; нужна iOS 16.4 или новее. Отдельное приложение не нужно.</div>
          </>
        )}
      </div>
      {state === 'off' && (
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(enablePush, 'Уведомления включены')}>
          {busy ? 'Включаем…' : 'Включить'}
        </button>
      )}
      {state === 'on' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('push/test', 'POST', {});
                toast('Отправили пробное уведомление');
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Проверить
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(disablePush)}>
            Выключить
          </button>
        </div>
      )}
    </div>
  );
}
