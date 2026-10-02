# LifeDashboard

Чек-листы для сборов (бассейн, работа, что угодно) и напоминания на день.
Живёт на `https://media-watch.ru/task`. Это **самостоятельный проект**: свой
репозиторий, процесс, база и вход. С MediaWatch пока общие только домен и
сервер, поэтому переезд — это перенос одного каталога и одного файла базы.

Дизайн — холст «Сборы и дела» в Claude Design.

## Как устроено

- **Next.js 14** с `basePath: '/task'`, процесс `lifedashboard-web` под pm2
  на `127.0.0.1:3100`. Снаружи до него доходит только nginx.
- **База — SQLite** (`/opt/lifedashboard/data/lifedashboard.db`, см.
  `src/lib/db.ts`). Схема создаётся при первом обращении. Бэкап — копия файла.
- **Вход — свой** (`src/lib/auth.ts`): логин и пароль (хэш scrypt) и сессии
  лежат в той же базе, кука `ld_session` — httpOnly, только на `/task`.
  Регистрации из интерфейса нет, пользователей заводит скрипт:

  ```bash
  node scripts/add-user.mjs <логин>           # новый пользователь или смена пароля
  node scripts/add-user.mjs <логин> --adopt   # забрать «ничейные» данные со времён входа через MediaWatch
  ```

  На сервере — из `/opt/lifedashboard/current` с
  `node --env-file=/opt/lifedashboard/.env ...`.
- **API** — один обработчик `src/app/api/[...path]/route.ts`.
- **Push-уведомления** (`src/lib/push.ts`, `public/sw.js`) — без отдельного
  приложения, через Web Push. Android и компьютеры — прямо в браузере;
  iPhone (iOS 16.4+) — только если LifeDashboard добавлен на экран «Домой».
  Подписки устройств с их часовым поясом лежат в своей базе, рассылка
  проверяет напоминания раз в 30 секунд. Ключи VAPID — в
  `/opt/lifedashboard/.env`, их один раз создаёт `scripts/deploy.sh`; менять
  их нельзя — отвалятся все подписанные телефоны.

## Разработка

```bash
npm install
LD_DEV_USER=dev-user npm run dev   # http://localhost:3200/task
```

`LD_DEV_USER` подставляет тестового пользователя только в `next dev`, без
входа; в продакшене эта переменная ни на что не влияет. Чтобы проверить сам
вход — заведите пользователя `node scripts/add-user.mjs <логин>` (база
`./data/lifedashboard.db`) и запустите без `LD_DEV_USER`.

## Выкладка

```bash
bash scripts/deploy.sh             # сервер — ssh-хост из LD_HOST (по умолчанию mediawatch-vps)
```

Скрипт собирает новую версию на сервере рядом с живой, переключает симлинк
`/opt/lifedashboard/current`, перезапускает pm2 и откатывается, если новая
версия не ответила. При первой выкладке он сам переносит базу и ключи VAPID
со старых «Сборов» (`/opt/sbory`). Подробности — в самом скрипте.

## Переезд на другой сервер или домен

1. Скопировать `/opt/lifedashboard/.env` и `/opt/lifedashboard/data/` на
   новый сервер (база — при остановленном процессе).
2. `LD_HOST=<новый-хост> bash scripts/deploy.sh`.
3. Новый домен или путь — поправить `basePath` в `next.config.js`, адреса
   `/task` в `src/` и `public/` и `VAPID_SUBJECT`. Push-подписки привязаны к
   домену, поэтому на новом домене телефоны подпишутся заново.

## nginx

В `server` сайта, ПЕРЕД `location /`:

```nginx
location = /task { proxy_pass http://127.0.0.1:3100; include /etc/nginx/snippets/sbory-proxy.conf; }
location /task/ { proxy_pass http://127.0.0.1:3100; include /etc/nginx/snippets/sbory-proxy.conf; }
```

`/etc/nginx/snippets/sbory-proxy.conf` — стандартные `proxy_set_header`
(Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto) и `proxy_http_version 1.1`.
`X-Real-IP` нужен защите входа от перебора.
