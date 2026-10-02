#!/usr/bin/env bash
set -euo pipefail

# Выкладка LifeDashboard на VPS (ssh-хост из LD_HOST, по умолчанию
# mediawatch-vps — пока сервер общий с MediaWatch, но с ним ничего не
# делится) под https://media-watch.ru/task. Запускать ЛОКАЛЬНО из корня
# проекта:
#
#   bash scripts/deploy.sh
#
# Что делает:
#  1. упаковывает исходники (без node_modules/.next/data) и кладёт на сервер
#     в НОВЫЙ каталог /opt/lifedashboard/releases/<метка>;
#  2. там npm ci + next build — живой сайт в это время работает со старой
#     сборки и ничего не замечает;
#  3. переключает симлинк /opt/lifedashboard/current на новую сборку и
#     перезапускает pm2-процесс lifedashboard-web; дым-тест; не ответил —
#     откат на прошлую сборку;
#  4. оставляет три последние сборки.
#
# База (/opt/lifedashboard/data/lifedashboard.db) лежит ВНЕ релизов и при
# выкладке не трогается.
#
# Переезд со «Сборов» (/opt/sbory, pm2 sbory-web) — сам, при первой выкладке:
# ключи VAPID и база копируются оттуда, старый процесс останавливается и после
# удачного дым-теста удаляется из pm2. Каталог /opt/sbory остаётся как бэкап —
# его можно удалить руками, когда всё проверено.

HOST="${LD_HOST:-mediawatch-vps}"
STAMP="$(date +%Y%m%d-%H%M%S)"
cd "$(dirname "$0")/.."

echo "==> упаковываю исходники"
tar -czf - \
  --exclude=node_modules --exclude=.next --exclude=out --exclude=data \
  --exclude='*.tsbuildinfo' --exclude=.git \
  . | ssh "$HOST" "mkdir -p /opt/lifedashboard/releases/$STAMP /opt/lifedashboard/data && tar -xzf - -C /opt/lifedashboard/releases/$STAMP"

ssh "$HOST" STAMP="$STAMP" bash -s <<'REMOTE'
set -euo pipefail
ROOT=/opt/lifedashboard
REL="$ROOT/releases/$STAMP"
DB="$ROOT/data/lifedashboard.db"
OLD=/opt/sbory

# Окружение создаётся один раз. Ключи VAPID переносим из «Сборов», если они
# там были: смена ключей отвязала бы все уже подписанные телефоны.
if [ ! -f "$ROOT/.env" ]; then
  echo "==> создаю $ROOT/.env"
  : > "$ROOT/.env"
  if [ -f "$OLD/.env" ]; then
    grep -E '^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=' "$OLD/.env" >> "$ROOT/.env" || true
  fi
  echo "LD_DB_PATH=$DB" >> "$ROOT/.env"
  chmod 600 "$ROOT/.env"
fi

cd "$REL"
echo "==> npm ci"
npm ci --no-audit --no-fund

# Ключи VAPID для push-уведомлений — один раз и навсегда. Создаём, только
# если их нет (ни своих, ни перенесённых).
if ! grep -q '^VAPID_PUBLIC_KEY=' "$ROOT/.env"; then
  echo "==> создаю ключи VAPID"
  node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\nVAPID_SUBJECT=https://media-watch.ru/task\n')" >> "$ROOT/.env"
fi
# Ключ шифрования базы (src/lib/dbKey.ts) — один раз и навсегда. Первый
# запуск с ключом зашифрует базу и копии; на случай неудачи держим открытую
# копию до конца дым-теста и после удачи стираем.
NEW_KEY=""
if ! grep -q '^LD_DATA_KEY=' "$ROOT/.env"; then
  echo "==> создаю ключ шифрования базы"
  node -e "process.stdout.write('LD_DATA_KEY='+require('crypto').randomBytes(32).toString('base64url')+'\n')" >> "$ROOT/.env"
  NEW_KEY=1
  if [ -f "$DB" ]; then
    for ext in "" -wal -shm; do
      [ -f "$DB$ext" ] && cp -p "$DB$ext" "$DB.pre-encrypt$ext"
    done
  fi
fi

echo "==> next build"
NEXT_TELEMETRY_DISABLED=1 npm run build

# Переезд со «Сборов»: оба процесса слушают 3100, и база должна быть
# скопирована с остановленного процесса — иначе часть записей осталась бы в
# его WAL. Поэтому: стоп старого, копия базы, потом старт нового.
MIGRATING=""
if pm2 describe sbory-web >/dev/null 2>&1; then
  MIGRATING=1
  echo "==> переезд со «Сборов»: останавливаю sbory-web"
  pm2 stop sbory-web
  if [ ! -f "$DB" ] && [ -f "$OLD/data/sbory.db" ]; then
    echo "==> копирую базу $OLD/data/sbory.db → $DB"
    for ext in "" -wal -shm; do
      [ -f "$OLD/data/sbory.db$ext" ] && cp -p "$OLD/data/sbory.db$ext" "$DB$ext"
    done
  fi
fi

PREV=""
[ -L "$ROOT/current" ] && PREV="$(readlink -f "$ROOT/current")"
ln -sfn "$REL" "$ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current"

echo "==> pm2"
if pm2 describe lifedashboard-web >/dev/null 2>&1; then
  pm2 restart lifedashboard-web --update-env
else
  pm2 start "$REL/ecosystem.config.js"
fi

echo "==> дым-тест"
CODE=""
for i in $(seq 1 15); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3100/task || true)"
  [ "$CODE" = "200" ] && break
  sleep 2
done
if [ "$CODE" != "200" ]; then
  echo "!! LifeDashboard отвечает $CODE"
  if [ -n "$NEW_KEY" ]; then
    # Прежняя версия не умеет в шифрование — возвращаем открытую базу.
    pm2 stop lifedashboard-web || true
    for ext in "" -wal -shm; do
      rm -f "$DB$ext"
      [ -f "$DB.pre-encrypt$ext" ] && mv "$DB.pre-encrypt$ext" "$DB$ext"
    done
    sed -i '/^LD_DATA_KEY=/d' "$ROOT/.env"
    echo "!! шифрование отменено, база возвращена как была"
  fi
  if [ -n "$MIGRATING" ]; then
    pm2 delete lifedashboard-web || true
    pm2 start sbory-web
    echo "!! переезд отменён, «Сборы» снова запущены"
  elif [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
    pm2 restart lifedashboard-web
    echo "!! откатился на $PREV"
  fi
  exit 1
fi

if [ -n "$MIGRATING" ]; then
  echo "==> удаляю sbory-web из pm2 (каталог $OLD остаётся как бэкап)"
  pm2 delete sbory-web
fi
pm2 save

if [ -n "$NEW_KEY" ]; then
  for ext in "" -wal -shm; do
    [ -f "$DB.pre-encrypt$ext" ] && { shred -u "$DB.pre-encrypt$ext" 2>/dev/null || rm -f "$DB.pre-encrypt$ext"; }
  done
  echo
  echo "!! База теперь зашифрована. Ключ — LD_DATA_KEY в $ROOT/.env."
  echo "!! Сохраните его в менеджер паролей: без ключа базу и копии не открыть."
  echo
fi

echo "==> убираю старые сборки (оставляю 3)"
ls -1dt "$ROOT"/releases/*/ | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$ROOT/current")" ] && continue
  rm -rf "$old"
done

if ! (cd "$REL" && node --env-file="$ROOT/.env" scripts/has-users.mjs) 2>/dev/null; then
  echo
  echo "!! Пользователей ещё нет — войти не получится. Заведите себя на сервере:"
  echo "   cd $ROOT/current && node --env-file=$ROOT/.env scripts/add-user.mjs <логин> --adopt"
  echo "   (--adopt — забрать себе данные, что были при входе через MediaWatch)"
fi
echo "==> done ($CODE)"
REMOTE
