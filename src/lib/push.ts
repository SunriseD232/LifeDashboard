import webpush from 'web-push';
import { readReminders, doneKeys, snoozesOn, type StoredReminder } from '../server/reminderStore';
import { minutesOf } from './dates';
import { db } from './db';
import { occurrencesOn, type Occurrence } from './occurrences';
import { deadlineNotices } from './tasks';
import { readSettings } from '../server/settings';
import { readTasks } from '../server/taskStore';
import { aiConfigured } from '../server/ai';
import { daySummary } from '../server/summary';
import { dueDay } from './recur';
import { inQuiet, outOfQuiet, quietMissed, quietOf, reviewItems } from './quiet';
import { plural } from './dates';

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
/** Сколько раз повторить push, если дело так и не отметили. */
export const NAG_TIMES = 3;
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
  slot?: string;
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

/** Местные дата и минуты суток в поясе tz. */
function localParts(tz: string, now: Date): { day: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return localParts(FALLBACK_TZ, now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Что отправить по этому появлению дела сейчас (minutes — местные минуты
 * суток): своё время и, если отложили, время «отложено до» — у каждого своя
 * отметка об отправке (push_sent.slot). Окно в 10 минут переживает
 * перезапуск процесса и пропущенный тик, но не шлёт «пора» спустя час.
 */
export function sendsDue(o: Occurrence, minutes: number): { mark: string; hm: string; repeat?: number }[] {
  if (o.done) return [];
  const late = (base: number) => minutes - base;
  const inWindow = (base: number) => late(base) >= 0 && late(base) <= WINDOW_MIN;
  const out: { mark: string; hm: string; repeat?: number }[] = [];
  if (inWindow(minutesOf(o.slot))) out.push({ mark: o.slot, hm: o.slot });
  if (o.snoozedTo && inWindow(minutesOf(o.snoozedTo))) out.push({ mark: `${o.slot}>${o.snoozedTo}`, hm: o.snoozedTo });
  // Не отметили — повторяем через nag минут от последнего срока (своего или
  // «отложено до»), до NAG_TIMES раз. Отметили «сделано» — o.done, тишина.
  const nag = o.reminder.nag;
  if (nag) {
    const base = o.snoozedTo ?? o.slot;
    for (let k = 1; k <= NAG_TIMES; k++) {
      if (inWindow(minutesOf(base) + k * nag)) out.push({ mark: `${base}+${k}`, hm: base, repeat: k });
    }
  }
  return out;
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
    const st = readSettings(d, userId);
    const quiet = quietOf(st.quiet_from, st.quiet_to);
    const all = readReminders(d, userId);
    const occ = occurrencesOn(all, lp.day, new Set(doneKeys(d, userId, lp.day)), snoozesOn(d, userId, lp.day));
    const mark = (key: string, slot: string) => d.prepare('insert or ignore into push_sent (reminder_id, day, slot) values (?, ?, ?)').run(key, lp.day, slot).changes > 0;
    // В тихие часы напоминания и повторы не шлём (и не помечаем) — что
    // осталось неотмеченным, придёт одним сообщением, когда они кончатся.
    const quietNow = inQuiet(lp.minutes, quiet);

    for (const o of quietNow ? [] : occ) {
      for (const s of sendsDue(o, lp.minutes)) {
        // Сначала помечаем, потом шлём: два тика подряд не отправят дважды.
        const fresh = d
          .prepare('insert or ignore into push_sent (reminder_id, day, slot) values (?, ?, ?)')
          .run(o.reminder.id, lp.day, s.mark);
        if (fresh.changes === 0) continue;
        const r = o.reminder as StoredReminder;
        // «После выполнения» и срок уже прошёл — висит с прошлых дней.
        const overdue = r.rule.kind === 'after' && lp.day > dueDay(r.rule, r.last_done);
        const lead = s.repeat ? `${s.hm} · не отмечено, напоминаю ещё раз` : s.hm !== o.slot ? `${s.hm} · отложено` : overdue ? `${o.slot} · давно пора` : `${o.slot}`;
        await sendToUser(userId, {
          title: r.title,
          body: r.checklist_title ? `${lead} · чек-лист «${r.checklist_title}»` : `${lead} — пора`,
          tag: `${r.id}:${lp.day}:${o.slot}`,
          // Нажатие откроет это напоминание крупно — с кнопкой «Сделано»
          // (на iPhone кнопок в самом уведомлении нет).
          url: `/task/tasks?focus=${encodeURIComponent(r.id)}&slot=${encodeURIComponent(o.slot)}`,
          reminderId: r.id,
          day: lp.day,
          slot: o.slot,
        });
      }
    }

    // Сроки дел: за день и в день срока, в своё время из настроек. Общие дела
    // семьи каждый участник получает в своём цикле — по своим видимым делам.
    const { tasks } = readTasks(d, userId, lp.day);
    // Конец тихих часов: одно сообщение о том, что пришлось на ночь.
    if (quiet) {
      const late = lp.minutes - minutesOf(quiet.to);
      const missed = quietMissed(occ, quiet);
      if (late >= 0 && late <= WINDOW_MIN && missed.length && mark(`quiet:${userId}`, 'morning')) {
        await sendToUser(userId, {
          title: missed.length === 1 ? missed[0].reminder.title : `Не отмечено: ${plural(missed.length, 'напоминание', 'напоминания', 'напоминаний')}`,
          body: missed.length === 1 ? `${missed[0].slot} — было в тихие часы` : missed.map((o) => o.reminder.title).slice(0, 5).join(', '),
          tag: `quiet:${lp.day}`,
          url: '/task/tasks',
        });
      }
    }

    for (const n of deadlineNotices(tasks, lp.day, lp.minutes, outOfQuiet(st.deadline_time, quiet))) {
      const fresh = d
        .prepare('insert or ignore into push_sent (reminder_id, day, slot) values (?, ?, ?)')
        .run(`task:${n.task.id}:${userId}`, lp.day, n.kind);
      if (fresh.changes === 0) continue;
      await sendToUser(userId, {
        title: n.task.title,
        body: n.kind === 'today' ? 'Сегодня срок' : 'Завтра срок — дело уже в «Срочно»',
        tag: `task:${n.task.id}:${lp.day}`,
        url: '/task/tasks',
      });
    }

    // Утренняя сводка от ИИ — в выбранное время, раз в день.
    if (st.summary_time && aiConfigured()) {
      const late = lp.minutes - minutesOf(outOfQuiet(st.summary_time, quiet));
      if (late >= 0 && late <= WINDOW_MIN) {
        const fresh = d.prepare('insert or ignore into push_sent (reminder_id, day, slot) values (?, ?, ?)').run(`summary:${userId}`, lp.day, 'summary');
        if (fresh.changes) {
          try {
            const text = await daySummary(d, userId, lp.day);
            await sendToUser(userId, { title: 'Сводка дня', body: text.slice(0, 400), tag: `summary:${lp.day}`, url: '/task' });
          } catch (e) {
            console.error('[lifedashboard push] сводка не получилась:', (e as Error).message);
          }
        }
      }
    }

    // Итог дня: что не сделано — открыть экран и перенести на завтра.
    if (st.review_time) {
      const late = lp.minutes - minutesOf(outOfQuiet(st.review_time, quiet));
      if (late >= 0 && late <= WINDOW_MIN) {
        const left = reviewItems(tasks, occ, lp.day);
        const n = left.tasks.length + left.reminders.length;
        if (n > 0 && mark(`review:${userId}`, 'review')) {
          await sendToUser(userId, {
            title: 'Итог дня',
            body: `Не сделано: ${plural(n, 'дело', 'дела', 'дел')}. Перенести на завтра?`,
            tag: `review:${lp.day}`,
            url: '/task/review',
          });
        }
      }
    }
  }

  d.prepare("delete from push_sent where day < date('now', '-3 day')").run();
  d.prepare("delete from reminder_snooze where day < date('now', '-3 day')").run();
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
