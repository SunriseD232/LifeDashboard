/**
 * LifeDashboard — приложение под media-watch.ru/task.
 *
 * Самостоятельный проект: свой Node-процесс (next start, pm2), своя база —
 * SQLite-файл на сервере (src/lib/db.ts), свой вход (src/lib/auth.ts). С
 * MediaWatch общий только домен.
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
