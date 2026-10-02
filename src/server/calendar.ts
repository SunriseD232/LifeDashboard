import type Database from 'better-sqlite3';
import { addDays, dueDay, occursOn } from '@/lib/recur';
import type { Task } from '@/lib/tasks';
import type { Reminder } from '@/lib/types';
import { readReminders } from './reminderStore';
import { readSettings } from './settings';
import { readTasks } from './taskStore';

/**
 * Календарь по подписке (iCalendar, RFC 5545): дела со сроком — событиями на
 * весь день, напоминания — на своё время на DAYS дней вперёд. Время
 * «плавающее» (без пояса): «18:30» — это 18:30 там, где телефон, как и у push.
 * Только чтение: календарь сам перечитывает ссылку.
 */

const DAYS = 60;
const MAX_EVENTS = 2000;

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ymd = (day: string) => day.replace(/-/g, '');

/** Строки длиннее 75 байт переносим: CRLF и пробел (RFC 5545, 3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

export function icsFor(tasks: Task[], reminders: Reminder[], today: string, now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeDashboard//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:LifeDashboard', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  const st = stamp(now);
  let count = 0;
  const event = (uid: string, props: string[]) => {
    if (count++ >= MAX_EVENTS) return;
    lines.push('BEGIN:VEVENT', `UID:${uid}@lifedashboard`, `DTSTAMP:${st}`, ...props, 'END:VEVENT');
  };

  for (const t of tasks) {
    if (t.done_at || !t.due_date) continue;
    event(`task-${t.id}`, [
      `DTSTART;VALUE=DATE:${ymd(t.due_date)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(t.due_date, 1))}`,
      `SUMMARY:${esc(`Срок: ${t.title}`)}`,
      ...(t.note ? [`DESCRIPTION:${esc(t.note)}`] : []),
      'TRANSP:TRANSPARENT',
    ]);
  }

  const last = addDays(today, DAYS);
  for (const r of reminders) {
    const days: string[] = [];
    if (r.rule.kind === 'after') {
      // Следующий раз один: дальше зависит от того, когда отметят.
      const due = dueDay(r.rule, r.last_done);
      days.push(due < today ? today : due);
    } else {
      for (let x = today; x <= last; x = addDays(x, 1)) if (occursOn(r.rule, x, r.last_done)) days.push(x);
    }
    for (const day of days) {
      for (const hm of r.times) {
        event(`rem-${r.id}-${ymd(day)}-${hm.replace(':', '')}`, [`DTSTART:${ymd(day)}T${hm.replace(':', '')}00`, 'DURATION:PT15M', `SUMMARY:${esc(r.title)}`, 'TRANSP:TRANSPARENT']);
      }
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Сегодня в поясе человека: из настроек города или самого свежего устройства. */
function todayFor(d: Database.Database, userId: string, now: Date): string {
  const sub = d.prepare('select tz from push_subscriptions where user_id = ? order by updated_at desc limit 1').get(userId) as { tz: string } | undefined;
  for (const tz of [readSettings(d, userId).tz, sub?.tz, 'Europe/Moscow']) {
    if (!tz) continue;
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
      /* следующий */
    }
  }
  return now.toISOString().slice(0, 10);
}

/** Лента по секрету из ссылки; null — такой ссылки нет (или отключили). */
export function calendarFeed(d: Database.Database, token: string, now = new Date()): string | null {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const row = d.prepare('select user_id from user_settings where calendar_token = ?').get(token) as { user_id: string } | undefined;
  if (!row) return null;
  const today = todayFor(d, row.user_id, now);
  const { tasks } = readTasks(d, row.user_id, today);
  return icsFor(tasks, readReminders(d, row.user_id), today, now);
}
