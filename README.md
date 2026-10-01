# Сборы

Чек-листы для сборов (бассейн, работа, что угодно) и напоминания на день.
Живёт на `https://media-watch.ru/task`, на том же сервере, что и MediaWatch,
но это **отдельный проект**: свой код (эта папка, свой git), свой процесс,
своя база.

Дизайн — холст «Сборы и дела» в Claude Design.

## Как устроено

- **Next.js 14** с `basePath: '/task'`, процесс `sbory-web` под pm2 на
  `127.0.0.1:3100`. Снаружи до него доходит только nginx.
- **База — SQLite** (`/opt/sbory/data/sbory.db`, см. `src/lib/db.ts`). Схема
  создаётся при первом обращении. Бэкап — копия файла.
- **Вход — аккаунт MediaWatch.** Тот же домен, та же кука сессии; сервер
  проверяет её у Supabase Auth (`src/lib/auth.ts`) и берёт оттуда только id
  пользователя. Все данные «Сборов» — в своей базе, у каждой строки `user_id`.
- **API** — один обработчик `src/app/api/[...path]/route.ts`.
- **Push-уведомления** (`src/lib/push.ts`, `public/sw.js`) — без отдельного
  приложения, через Web Push. Android и компьютеры — прямо в браузере;
  iPhone (iOS 16.4+) — только если «Сборы» добавлены на экран «Домой».
  Подписки устройств с их часовым поясом лежат в своей базе, рассылка
  проверяет напоминания раз в 30 секунд. Ключи VAPID — в `/opt/sbory/.env`,
  их один раз создаёт `scripts/deploy.sh`; менять их нельзя — отвалятся все
  подписанные телефоны.

## Разработка

```bash
npm install
SBORY_DEV_USER=dev-user npm run dev   # http://localhost:3200/task
```

`SBORY_DEV_USER` подставляет тестового пользователя только в `next dev`; в
продакшене эта переменная ни на что не влияет.

## Выкладка

```bash
bash scripts/deploy.sh
```

Скрипт собирает новую версию на сервере рядом с живой, переключает симлинк
`/opt/sbory/current`, перезапускает pm2 и откатывается, если новая версия не
ответила. Подробности — в самом скрипте.

## nginx

В `server` сайта media-watch.ru, ПЕРЕД `location /`:

```nginx
location = /task { proxy_pass http://127.0.0.1:3100; include /etc/nginx/snippets/sbory-proxy.conf; }
location /task/ { proxy_pass http://127.0.0.1:3100; include /etc/nginx/snippets/sbory-proxy.conf; }
```

`/etc/nginx/snippets/sbory-proxy.conf` — стандартные `proxy_set_header`
(Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto) и `proxy_http_version 1.1`.
