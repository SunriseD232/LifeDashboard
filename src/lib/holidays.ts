/**
 * Праздники страны на календаре. Общее для сервера (разбор источников) и
 * экрана (какой день красный).
 *
 * Названия — Nager.Date (любая страна). Для России, Беларуси и Казахстана
 * ещё производственный календарь xmlcalendar.ru: в нём переносы —
 * выходной понедельник вместо праздника в воскресенье, рабочая суббота,
 * сокращённый день накануне.
 */

export type HolidayKind =
  /** Государственный праздник, выходной. */
  | 'holiday'
  /** Нерабочий будний день: перенесённый выходной, каникулы. */
  | 'dayoff'
  /** Рабочая суббота или воскресенье (перенос). */
  | 'workday'
  /** Сокращённый рабочий день накануне праздника. */
  | 'short';

export interface Holiday {
  day: string;
  name: string;
  kind: HolidayKind;
}

/** Страны с производственным календарём на xmlcalendar.ru. */
export const WORK_CALENDAR = ['RU', 'BY', 'KZ'];

export const COUNTRY_RE = /^[A-Z]{2}$/;

/** Ответ Nager.Date: /api/v3/PublicHolidays/{year}/{country}. */
export interface NagerHoliday {
  date: string;
  localName?: string;
  name?: string;
  global?: boolean;
  types?: string[];
}

/**
 * Государственные праздники по всей стране (не региональные и не
 * «памятные дни»). Название — местное, если оно кириллицей, иначе английское:
 * грузинское или китайское никто не прочтёт.
 */
export function fromNager(list: unknown): Holiday[] {
  if (!Array.isArray(list)) return [];
  const out = new Map<string, Holiday>();
  for (const h of list as NagerHoliday[]) {
    if (typeof h?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue;
    if (h.global === false || (Array.isArray(h.types) && !h.types.includes('Public'))) continue;
    const local = typeof h.localName === 'string' ? h.localName.trim() : '';
    const name = (/[А-Яа-яЁё]/.test(local) ? local : (h.name ?? local).trim()).slice(0, 80);
    if (!name) continue;
    // Два праздника в один день — через «; ».
    const prev = out.get(h.date);
    if (prev && prev.name !== name) prev.name = `${prev.name}; ${name}`.slice(0, 120);
    else if (!prev) out.set(h.date, { day: h.date, name, kind: 'holiday' });
  }
  return [...out.values()];
}

/** Производственный календарь xmlcalendar.ru: нерабочие дни по месяцам, «9+» — перенос, «30*» — сокращённый. */
export interface WorkCalendar {
  year?: number;
  months?: { month: number; days: string }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const isWeekend = (day: string) => {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

/**
 * Праздники Nager + переносы из производственного календаря. Нерабочий будний
 * день без праздника — нерабочий (перенос, каникулы); суббота или воскресенье, которых
 * нет среди нерабочих, — рабочий день.
 */
export function mergeWorkCalendar(year: number, holidays: Holiday[], cal: unknown): Holiday[] {
  const c = cal as WorkCalendar;
  if (!c || !Array.isArray(c.months) || c.months.length !== 12) return holidays;
  const off = new Set<string>();
  const short = new Set<string>();
  for (const m of c.months) {
    if (!Number.isInteger(m?.month) || m.month < 1 || m.month > 12 || typeof m.days !== 'string') return holidays;
    for (const raw of m.days.split(',')) {
      const n = parseInt(raw, 10);
      if (!(n >= 1 && n <= 31)) continue;
      const day = `${year}-${pad(m.month)}-${pad(n)}`;
      if (raw.includes('*')) short.add(day);
      else off.add(day);
    }
  }
  const byDay = new Map(holidays.map((h) => [h.day, h]));
  const out: Holiday[] = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const h = byDay.get(day);
    if (h) out.push(h);
    else if (off.has(day) && !isWeekend(day)) out.push({ day, name: 'Нерабочий день', kind: 'dayoff' });
    else if (!off.has(day) && isWeekend(day)) out.push({ day, name: 'Рабочий день (перенос)', kind: 'workday' });
    else if (short.has(day)) out.push({ day, name: 'Сокращённый день', kind: 'short' });
  }
  return out;
}

/** Нерабочий день: праздник, перенесённый выходной или суббота/воскресенье без переноса. */
export function isDayOff(day: string, h: Holiday | null | undefined): boolean {
  if (h) return h.kind === 'holiday' || h.kind === 'dayoff';
  return isWeekend(day);
}

/** Название страны по-русски: «RU» → «Россия». */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
