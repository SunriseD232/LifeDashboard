/*
 * Сервис-воркер LifeDashboard: работа без сети и push-уведомления.
 *
 * Без сети: страницы, которые уже открывали, и файлы приложения берутся из
 * кэша — приложение открывается и показывает сохранённые данные (их хранит
 * само приложение, src/lib/offline.ts). API не кэшируем: данные — только
 * свежие или из той сохранённой копии. Его задачи:
 *  - push: показать уведомление о деле (сервер шлёт в момент напоминания,
 *    см. src/lib/push.ts);
 *  - клик по уведомлению: открыть LifeDashboard на вкладке напоминаний;
 *  - кнопки «Сделано» и «Через час» (Android/Chrome — iOS кнопок у
 *    уведомлений не показывает): отметить или отложить дело, не открывая
 *    приложение. Запрос same-origin, кука входа уходит вместе с ним сама.
 */

const VERSION = 'v2';
const STATIC = `ld-static-${VERSION}`;
const PAGES = `ld-pages-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('ld-') && !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

const OFFLINE_PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Нет сети</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#0e1615;color:#e6efed;text-align:center;padding:16px}
a{color:#5fd3c6}</style></head><body><div><p style="font-size:20px;font-weight:600">Нет сети</p>
<p>Этот раздел ещё не открывался на этом устройстве — без интернета его не показать.</p><p><a href="/task">Открыть главную</a></p></div></body></html>`;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/task') || url.pathname.startsWith('/task/api/')) return;

  // Файлы сборки неизменны (в имени — хэш): сначала кэш.
  if (url.pathname.startsWith('/task/_next/static/')) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Страницы: сначала сеть (и запомнить), без сети — то, что запомнили.
  if (req.mode === 'navigate') {
    const key = url.origin + url.pathname.replace(/\/$/, '');
    event.respondWith(
      (async () => {
        const c = await caches.open(PAGES);
        try {
          const res = await fetch(req);
          if (res.ok) c.put(key, res.clone());
          return res;
        } catch (e) {
          // Чужую страницу вместо этой не подставляем — приложение запуталось бы в адресе.
          const hit = await c.match(key);
          return hit || new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      })(),
    );
    return;
  }

  // Иконки и манифест: из кэша сразу, в фоне — обновить.
  if (/\.(png|svg|ico|webmanifest|json)$/.test(url.pathname) && !url.searchParams.has('_rsc')) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
  // Остальное (данные страниц для переходов) — как есть: без сети переход
  // станет обычной загрузкой страницы, а её отдаст кэш выше.
});

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
    data: { url: data.url || '/task/tasks', reminderId: data.reminderId, day: data.day, slot: data.slot },
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
        if ('navigate' in open) await open.navigate(url || '/task/tasks');
        return;
      }
      await self.clients.openWindow(url || '/task/tasks');
    })(),
  );
});
