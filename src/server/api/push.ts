import { sendToUser, vapidPublicKey } from '@/lib/push';
import { HttpError, type Ctx } from '../http';

/** Push-сервисы браузеров: Chrome/Яндекс/Edge (FCM), Safari (Apple),
 *  Firefox (Mozilla), старый Edge (Windows). */
const PUSH_HOSTS =
  /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;

/** Push-уведомления (src/lib/push.ts): /api/push/{key,subscribe,unsubscribe,test}. */
export async function push({ d, userId, method, body, id }: Ctx): Promise<unknown> {
  if (method === 'GET' && id === 'key') {
    return { key: vapidPublicKey() };
  }
  if (method === 'POST' && id === 'subscribe') {
    const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
    // Только настоящие push-сервисы браузеров: на этот адрес потом ходит
    // наш сервер, и произвольный URL превратил бы рассылку в способ слать
    // запросы куда угодно от имени сервера.
    let host = '';
    try {
      const u = new URL(endpoint);
      host = u.protocol === 'https:' ? u.hostname : '';
    } catch {
      host = '';
    }
    if (!PUSH_HOSTS.test(host) || endpoint.length > 1000 || !p256dh || !auth) {
      throw new HttpError(400, 'Неверная подписка.');
    }
    let tz = typeof body.tz === 'string' && body.tz.length < 64 ? body.tz : 'Europe/Moscow';
    try {
      new Intl.DateTimeFormat('ru', { timeZone: tz });
    } catch {
      tz = 'Europe/Moscow';
    }
    d.prepare(
      `insert into push_subscriptions (endpoint, user_id, p256dh, auth, tz, updated_at)
       values (?, ?, ?, ?, ?, datetime('now'))
       on conflict(endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
         auth = excluded.auth, tz = excluded.tz, updated_at = excluded.updated_at`,
    ).run(endpoint, userId, p256dh, auth, tz);
    return { ok: true };
  }
  if (method === 'POST' && id === 'unsubscribe') {
    if (typeof body.endpoint === 'string') {
      d.prepare('delete from push_subscriptions where endpoint = ? and user_id = ?').run(body.endpoint, userId);
    }
    return { ok: true };
  }
  if (method === 'POST' && id === 'test') {
    const delivered = await sendToUser(userId, {
      title: 'LifeDashboard',
      body: 'Уведомления работают — напомним о делах вовремя.',
      tag: 'test',
      url: '/task/tasks',
    });
    if (!delivered) throw new HttpError(409, 'Не удалось отправить: включите уведомления на этом устройстве ещё раз.');
    return { delivered };
  }
  return undefined;
}
