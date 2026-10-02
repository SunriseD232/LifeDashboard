/*
 * Сервис-воркер LifeDashboard — только для push-уведомлений.
 *
 * Ничего не кэширует: приложение онлайн-только, и кэш свежих списков между
 * устройствами дал бы больше путаницы, чем пользы. Его задачи:
 *  - push: показать уведомление о деле (сервер шлёт в момент напоминания,
 *    см. src/lib/push.ts);
 *  - клик по уведомлению: открыть LifeDashboard на вкладке напоминаний;
 *  - кнопки «Сделано» и «Через час» (Android/Chrome — iOS кнопок у
 *    уведомлений не показывает): отметить или отложить дело, не открывая
 *    приложение. Запрос same-origin, кука входа уходит вместе с ним сама.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'LifeDashboard', body: event.data ? event.data.text() : '' };
  }
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/task/icon-192.png',
    badge: '/task/badge-96.png',
    lang: 'ru',
    renotify: !!data.tag,
    data: { url: data.url || '/task/reminders', reminderId: data.reminderId, day: data.day, slot: data.slot },
    actions: data.reminderId
      ? [{ action: 'done', title: 'Сделано' }].concat(snoozeAt() ? [{ action: 'snooze', title: 'Через час' }] : [])
      : [],
  };
  event.waitUntil(self.registration.showNotification(data.title || 'LifeDashboard', options));
});

/** Местное время через час, 'ЧЧ:ММ'; null — если это уже завтра. */
function snoozeAt() {
  const t = new Date(Date.now() + 60 * 60 * 1000);
  if (t.getDate() !== new Date().getDate()) return null;
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

function api(path, body, method) {
  return fetch(`/task/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  const { url, reminderId, day, slot } = n.data || {};

  if (event.action === 'done' && reminderId && day) {
    event.waitUntil(api(`reminders/${reminderId}/done`, { day, slot, done: true }, 'PUT'));
    return;
  }
  if (event.action === 'snooze' && reminderId && day) {
    const at = snoozeAt();
    if (at) event.waitUntil(api(`reminders/${reminderId}/snooze`, { day, slot, at }, 'POST'));
    return;
  }

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = all.find((c) => new URL(c.url).pathname.startsWith('/task'));
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url || '/task/reminders');
        return;
      }
      await self.clients.openWindow(url || '/task/reminders');
    })(),
  );
});
