#!/usr/bin/env bash
set -euo pipefail

# Выкладка «Сборов» на тот же VPS, что и MediaWatch (ssh-хост mediawatch-vps),
# под https://media-watch.ru/task. Запускать ЛОКАЛЬНО из корня проекта:
#
#   bash scripts/deploy.sh
#
# Что делает:
#  1. упаковывает исходники (без node_modules/.next/data) и кладёт на сервер
#     в НОВЫЙ каталог /opt/sbory/releases/<метка>;
#  2. там npm ci + next build — живой сайт в это время работает со старой
#     сборки и ничего не замечает;
#  3. переключает симлинк /opt/sbory/current на новую сборку и перезапускает
#     pm2-процесс sbory-web; дым-тест; не ответил — откат на прошлую сборку;
#  4. оставляет три последние сборки.
#
# База (/opt/sbory/data/sbory.db) лежит ВНЕ релизов и при выкладке не
# трогается.

HOST="${SBORY_HOST:-mediawatch-vps}"
STAMP="$(date +%Y%m%d-%H%M%S)"
cd "$(dirname "$0")/.."

echo "==> упаковываю исходники"
tar -czf - \
  --exclude=node_modules --exclude=.next --exclude=out --exclude=data \
  --exclude='*.tsbuildinfo' --exclude=.git \
  . | ssh "$HOST" "mkdir -p /opt/sbory/releases/$STAMP /opt/sbory/data && tar -xzf - -C /opt/sbory/releases/$STAMP"

ssh "$HOST" STAMP="$STAMP" bash -s <<'REMOTE'
set -euo pipefail
ROOT=/opt/sbory
REL="$ROOT/releases/$STAMP"

# Окружение создаётся один раз: адрес и публичный ключ Supabase берём у
# MediaWatch на этом же сервере (нужны только чтобы проверять вход — данные
# «Сборов» в Supabase не хранятся), путь к своей базе — свой.
if [ ! -f "$ROOT/.env" ]; then
  echo "==> создаю $ROOT/.env"
  : > "$ROOT/.env.tmp"
  for f in /opt/mediawatch/.env /opt/mediawatch/.env.production /opt/mediawatch/.env.local; do
    [ -f "$f" ] || continue
    grep -E '^NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)=' "$f" | sed 's/^NEXT_PUBLIC_//' >> "$ROOT/.env.tmp" || true
  done
  # Последнее значение побеждает — тот же порядок, что у Next.js в MediaWatch.
  tac "$ROOT/.env.tmp" | awk -F= '!seen[$1]++' > "$ROOT/.env"
  rm -f "$ROOT/.env.tmp"
  echo "SBORY_DB_PATH=$ROOT/data/sbory.db" >> "$ROOT/.env"
  chmod 600 "$ROOT/.env"
  grep -q '^SUPABASE_URL=' "$ROOT/.env" || { echo "!! не нашёл адрес Supabase у MediaWatch"; exit 1; }
fi

cd "$REL"
echo "==> npm ci"
npm ci --no-audit --no-fund

# Ключи VAPID для push-уведомлений — один раз и навсегда: смена ключей
# отвязала бы все уже подписанные телефоны. Создаём, только если их нет.
if ! grep -q '^VAPID_PUBLIC_KEY=' "$ROOT/.env"; then
  echo "==> создаю ключи VAPID"
  node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\nVAPID_SUBJECT=https://media-watch.ru/task\n')" >> "$ROOT/.env"
fi
echo "==> next build"
NEXT_TELEMETRY_DISABLED=1 npm run build

PREV=""
[ -L "$ROOT/current" ] && PREV="$(readlink -f "$ROOT/current")"
ln -sfn "$REL" "$ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current"

echo "==> pm2"
if pm2 describe sbory-web >/dev/null 2>&1; then
  pm2 restart sbory-web --update-env
else
  pm2 start "$REL/ecosystem.config.js"
  pm2 save
fi

echo "==> дым-тест"
CODE=""
for i in $(seq 1 15); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3100/task || true)"
  [ "$CODE" = "200" ] && break
  sleep 2
done
if [ "$CODE" != "200" ]; then
  echo "!! «Сборы» отвечают $CODE"
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
    pm2 restart sbory-web
    echo "!! откатился на $PREV"
  fi
  exit 1
fi

echo "==> убираю старые сборки (оставляю 3)"
ls -1dt "$ROOT"/releases/*/ | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$ROOT/current")" ] && continue
  rm -rf "$old"
done
echo "==> done ($CODE)"
REMOTE
