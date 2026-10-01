'use client';

import { api } from './api';

/**
 * Push в браузере: регистрация сервис-воркера, подписка, отписка.
 *
 * Где работает без приложения:
 *  - Android (Chrome, Яндекс, Firefox, Edge) и компьютеры — сразу в браузере;
 *  - iPhone/iPad (iOS 16.4+) — только из «Сборов», добавленных на экран
 *    «Домой»: Safari во вкладке push не умеет. Это ограничение Apple, и его
 *    мы честно показываем инструкцией вместо кнопки.
 */

export type PushState = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const SW_URL = '/task/sw.js';
const SW_SCOPE = '/task';

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ представляется Mac'ом — отличаем по сенсорному экрану.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return existing ?? navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
}

function keyBytes(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}

async function send(sub: PushSubscription) {
  await api('push/subscribe', 'POST', { subscription: sub.toJSON(), tz: timezone() });
}

/** Текущее состояние на этом устройстве. Подписка есть — заодно обновляем на
 *  сервере (часовой пояс мог смениться, а сервер мог её забыть). */
export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    send(sub).catch(() => {});
    return 'on';
  }
  return 'off';
}

export async function enablePush(): Promise<PushState> {
  // Разрешение — первым и прямо из нажатия: Safari иначе откажет молча.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { key } = await api<{ key: string | null }>('push/key');
  if (!key) throw new Error('Уведомления на сервере ещё не настроены.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await send(sub);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}
