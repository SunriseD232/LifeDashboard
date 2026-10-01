/**
 * pm2 для «Сборов» на сервере (/opt/sbory). Процесс отдельный от MediaWatch
 * и слушает только localhost:3100 — снаружи до него доходит лишь nginx
 * (location /task, см. README).
 *
 * Окружение — из /opt/sbory/.env через --env-file (Node 20.6+): там адрес и
 * публичный ключ Supabase для проверки входа и путь к своей базе SQLite.
 * Файл создаёт scripts/deploy.sh при первой выкладке и в git не входит.
 */
module.exports = {
  apps: [
    {
      name: 'sbory-web',
      cwd: '/opt/sbory/current',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100 -H 127.0.0.1',
      node_args: '--env-file=/opt/sbory/.env',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
