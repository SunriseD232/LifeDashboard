import webpush from 'web-push';
import { db } from './db';

/**
 * Push-уведомления LifeDashboard (Web Push, без отдельного приложения).
 *
 * Телефон подписывается из браузера (Android — сразу; iPhone — только когда
 * LifeDashboard добавлен на экран «Домой», это требование Apple), подписка с
 * часовым поясом устройства лежит в своей базе (push_subscriptions). Раз в
 * 30 секунд сервер смотрит, у кого наступило время дела, и шлёт push через
 * сервис браузера (FCM, Apple, Mozilla) — с ключами VAPID из окружения.
 *
 * Время напоминаний — МЕСТНОЕ: «18:00» значит 18:00 там, где телефон. Поэтому
 * сутки и минуты считаем в поясе устройства, а не сервера.
 */

const WINDOW_MIN = 10;
const TICK_MS = 30_000;
const FALLBACK_TZ = 'Europe/Moscow';

let configured: boolean | null = null;

function configure(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn('[lifedashboard push] VAPID-ключей нет — push выключен');
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://media-watch.ru/task', pub, priv);
  configured = true;
  return true;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  reminderId?: string;
  day?: string;
}

/** Отправить всем устройствам пользователя. Мёртвые подписки удаляем. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!configure()) return 0;
  const d = db();
  const subs = d
    .prepare('select endpoint, p256dh, auth from push_subscriptions where user_id = ?')
    .all(userId) as { endpoint: string; p256dh: string; auth: string }[];
  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          // Дело на конкретную минуту: если телефон был офлайн дольше часа,
          // старое «пора собрать сумку» уже не нужно.
          { TTL: 3600, urgency: 'high' },
        );
        delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 — подписка отозвана (сняли разрешение, удалили сайт с
        // экрана «Домой», переустановили браузер). Больше не пытаемся.
        if (status === 404 || status === 410) {
          d.prepare('delete from push_subscriptions where endpoint = ?').run(s.endpoint);
        } else {
          console.error('[lifedashboard push] не отправилось:', status ?? (e as Error).message);
        }
      }
    }),
  );
  return delivered;
}

/** Местные дата, минуты суток и день недели в поясе tz. */
function localParts(tz: string, now: Date): { day: string; minutes: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return localParts(FALLBACK_TZ, now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: weekdays.indexOf(get('weekday')),
  };
}

interface DueReminder {
  id: string;
  title: string;
  at_time: string;
  repeat: 'once' | 'daily' | 'weekdays';
  on_date: string | null;
  checklist_title: string | null;
}

async function tick(): Promise<void> {
  if (!configure()) return;
  const d = db();
  const now = new Date();

  // Пояс пользователя — с самого свежего его устройства.
  const users = new Map<string, string>();
  for (const row of d
    .prepare('select user_id, tz from push_subscriptions order by updated_at desc')
    .all() as { user_id: string; tz: string }[]) {
    if (!users.has(row.user_id)) users.set(row.user_id, row.tz);
  }

  for (const [userId, tz] of users) {
    const lp = localParts(tz, now);
    const reminders = d
      .prepare(
        `select r.id, r.title, r.at_time, r.repeat, r.on_date, c.title as checklist_title
         from reminders r left join checklists c on c.id = r.checklist_id
         where r.user_id = ?`,
      )
      .all(userId) as DueReminder[];

    for (const r of reminders) {
      const applies =
        r.repeat === 'daily' ||
        (r.repeat === 'weekdays' && lp.weekday >= 1 && lp.weekday <= 5) ||
        (r.repeat === 'once' && r.on_date === lp.day);
      if (!applies) continue;
      const [h, m] = r.at_time.split(':').map(Number);
      const late = lp.minutes - (h * 60 + m);
      // Окно в 10 минут — переживаем перезапуск процесса и пропущенный тик,
      // но не шлём «пора» спустя час.
      if (late < 0 || late > WINDOW_MIN) continue;
      if (d.prepare('select 1 from reminder_done where reminder_id = ? and day = ?').get(r.id, lp.day)) continue;
      // Сначала помечаем, потом шлём: два тика подряд не отправят дважды.
      const fresh = d.prepare('insert or ignore into push_sent (reminder_id, day) values (?, ?)').run(r.id, lp.day);
      if (fresh.changes === 0) continue;

      const hm = r.at_time.slice(0, 5);
      await sendToUser(userId, {
        title: r.title,
        body: r.checklist_title ? `${hm} · чек-лист «${r.checklist_title}»` : `${hm} — пора`,
        tag: `${r.id}:${lp.day}`,
        url: '/task/reminders',
        reminderId: r.id,
        day: lp.day,
      });
    }
  }

  d.prepare("delete from push_sent where day < date('now', '-3 day')").run();
}

declare global {
  // eslint-disable-next-line no-var
  var __ldPushTimer: ReturnType<typeof setInterval> | undefined;
}

/** Запуск рассылки — один раз на процесс (src/instrumentation.ts). */
export function startScheduler(): void {
  if (global.__ldPushTimer) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      console.error('[lifedashboard push] рассылка упала:', e);
    } finally {
      running = false;
    }
  };
  global.__ldPushTimer = setInterval(run, TICK_MS);
  setTimeout(run, 5_000);
  console.log('[lifedashboard push] рассылка запущена');
}
