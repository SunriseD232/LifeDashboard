import type Database from 'better-sqlite3';
import { addDays, dueDay, nextOccurrence, weekday, type Rule } from '@/lib/recur';
import type { Reminder } from '@/lib/types';
import { readReminders } from './reminderStore';
import { readSettings } from './settings';

/**
 * Календарь по подписке (iCalendar, RFC 5545): дела со сроком — событиями на
 * весь день, напоминания — на своё время. Повторы — настоящими повторяющимися
 * событиями (RRULE): календарь сам разворачивает их на любой срок. «После
 * выполнения» — одним ближайшим разом: дальше зависит от отметки. Время
 * «плавающее» (без пояса): «18:30» — это 18:30 там, где телефон, как и у push.
 * Только чтение: календарь сам перечитывает ссылку.
 */

const MAX_EVENTS = 2000;

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Дни 28..d — с BYSETPOS=-1 даёт «d-е, а в коротком месяце — последний», как у нас. */
const clampDays = (d: number) => (d <= 28 ? String(d) : Array.from({ length: d - 27 }, (_, i) => 28 + i).join(','));

/**
 * Календарный повтор → RRULE. allDay — для дел (событие на день): тогда UNTIL
 * датой, иначе — концом дня в «плавающем» времени, как и DTSTART.
 */
export function rrule(rule: Extract<Rule, { kind: 'repeat' }>, allDay = false): string {
  const parts = [`FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[rule.unit]}`];
  if (rule.every > 1) parts.push(`INTERVAL=${rule.every}`);
  const sd = Number(rule.start.slice(8));
  if (rule.unit === 'week') {
    const days = rule.weekdays?.length ? rule.weekdays : [weekday(rule.start)];
    parts.push(`BYDAY=${days.map((w) => BYDAY[w]).join(',')}`, 'WKST=MO');
  }
  if (rule.unit === 'month') {
    const mo = rule.monthly ?? { type: 'day' as const, day: sd };
    if (mo.type === 'nth') parts.push(`BYDAY=${mo.nth}${BYDAY[mo.weekday]}`);
    else if (mo.day === -1) parts.push('BYMONTHDAY=-1');
    else {
      parts.push(`BYMONTHDAY=${clampDays(mo.day)}`);
      if (mo.day > 28) parts.push('BYSETPOS=-1');
    }
  }
  if (rule.unit === 'year') {
    parts.push(`BYMONTH=${Number(rule.start.slice(5, 7))}`, `BYMONTHDAY=${clampDays(sd)}`);
    if (sd > 28) parts.push('BYSETPOS=-1');
  }
  if (rule.end?.type === 'until') parts.push(`UNTIL=${ymd(rule.end.date)}${allDay ? '' : 'T235959'}`);
  if (rule.end?.type === 'count') parts.push(`COUNT=${rule.end.count}`);
  return `RRULE:${parts.join(';')}`;
}

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

export function icsFor(reminders: Reminder[], today: string, now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeDashboard//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:LifeDashboard', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  const st = stamp(now);
  let count = 0;
  const event = (uid: string, props: string[]) => {
    if (count++ >= MAX_EVENTS) return;
    lines.push('BEGIN:VEVENT', `UID:${uid}@lifedashboard`, `DTSTAMP:${st}`, ...props, 'END:VEVENT');
  };

  for (const r of reminders) {
    const hhmm = (hm: string) => hm.replace(':', '');
    const rule = r.rule;
    if (rule.kind === 'repeat') {
      // DTSTART — первый настоящий раз: иначе календарь посчитал бы его лишним.
      const first = nextOccurrence(rule, rule.start);
      if (!first) continue;
      for (const hm of r.times) {
        event(`rem-${r.id}-${hhmm(hm)}`, [`DTSTART:${ymd(first)}T${hhmm(hm)}00`, 'DURATION:PT15M', rrule(rule), `SUMMARY:${esc(r.title)}`, 'TRANSP:TRANSPARENT']);
      }
      continue;
    }
    // Разовое — в свой день; «после выполнения» — ближайший раз (просрочено — сегодня).
    const day = rule.kind === 'once' ? rule.date : dueDay(rule, r.last_done) < today ? today : dueDay(rule, r.last_done);
    if (rule.kind === 'once' && day < addDays(today, -30)) continue;
    for (const hm of r.times) {
      event(`rem-${r.id}-${ymd(day)}-${hhmm(hm)}`, [`DTSTART:${ymd(day)}T${hhmm(hm)}00`, 'DURATION:PT15M', `SUMMARY:${esc(r.title)}`, 'TRANSP:TRANSPARENT']);
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
  return icsFor(readReminders(d, row.user_id), today, now);
}
