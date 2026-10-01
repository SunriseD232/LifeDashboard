/**
 * «Сборы» — приложение под media-watch.ru/task.
 *
 * Свой Node-процесс (next start, pm2) и своя база — SQLite-файл на сервере
 * (см. src/lib/db.ts). С MediaWatch общий только вход: тот же домен, та же
 * кука сессии, по ней сервер узнаёт пользователя (см. src/lib/auth.ts).
 *
 * basePath '/task' — все страницы, API и файлы сборки живут под этим
 * префиксом; nginx отдаёт этот префикс сюда, а корень домена — MediaWatch.
 */
/** @type {import('next').NextConfig} */
module.exports = {
  basePath: '/task',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Нативный модуль — не бандлим, грузим из node_modules как есть.
    serverComponentsExternalPackages: ['better-sqlite3', 'web-push'],
    // src/instrumentation.ts — запуск рассылки push при старте сервера.
    instrumentationHook: true,
  },
  async headers() {
    return [
      {
        // Сервис-воркер лежит в /task/sw.js, и по умолчанию его область —
        // /task/, а сама страница — /task (без слэша), то есть мимо. Этот
        // заголовок разрешает зарегистрировать его на всю /task. no-cache —
        // чтобы правки воркера доходили до телефонов сразу.
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/task' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ];
  },
};
