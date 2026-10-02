/**
 * pm2 для LifeDashboard на сервере (/opt/lifedashboard). Слушает только
 * localhost:3100 — снаружи до него доходит лишь nginx (location /task, см.
 * README).
 *
 * Окружение — из /opt/lifedashboard/.env через --env-file (Node 20.6+): путь
 * к своей базе SQLite и ключи VAPID. Файл создаёт scripts/deploy.sh при первой
 * выкладке, в git он не входит.
 */
module.exports = {
  apps: [
    {
      name: 'lifedashboard-web',
      cwd: '/opt/lifedashboard/current',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100 -H 127.0.0.1',
      node_args: '--env-file=/opt/lifedashboard/.env',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
