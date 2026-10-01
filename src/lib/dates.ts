import type { Reminder } from './types';

/** Дата в ЛОКАЛЬНОМ времени пользователя: «сегодня» — его сутки, не UTC. */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Попадает ли напоминание на этот день. */
export function appliesOn(r: Reminder, d: Date): boolean {
  if (r.repeat === 'daily') return true;
  if (r.repeat === 'weekdays') {
    const wd = d.getDay();
    return wd >= 1 && wd <= 5;
  }
  return r.on_date === localDay(d);
}

/** '13:05:00' → минуты от начала суток. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function hhmm(time: string): string {
  return time.slice(0, 5);
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function dayTitle(d: Date): string {
  const wd = WEEKDAYS[d.getDay()];
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

/** «через 25 мин», «через 2 ч 10 мин». */
export function inMinutes(n: number): string {
  if (n < 1) return 'сейчас';
  if (n < 60) return `через ${n} мин`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
}

/** «12 вещей», «1 вещь», «3 вещи». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return `${n} ${one}`;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
