import type Database from 'better-sqlite3';
import { fromNager, mergeWorkCalendar, WORK_CALENDAR, type Holiday } from '@/lib/holidays';

/**
 * Праздники страны за год: из holiday_cache, а раз в неделю — заново из
 * источников (src/lib/holidays.ts). Источники молчат — отдаём старое; старого
 * нет — пустой год, и не дёргаем их снова 10 минут.
 */

type Transport = (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

let transport: Transport = (url) => fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store', headers: { 'User-Agent': 'LifeDashboard' } });

/** Для тестов: подменить сеть. */
export function setHolidaysTransport(t: Transport) {
  transport = t;
}

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const failed = new Map<string, number>();
const running = new Map<string, Promise<Holiday[] | null>>();

async function get(url: string): Promise<unknown> {
  const res = await transport(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Из источников. Nager не ответил — null (производственного календаря без названий мало). */
export async function fetchHolidays(country: string, year: number): Promise<Holiday[] | null> {
  let list: Holiday[];
  try {
    list = fromNager(await get(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`));
  } catch {
    return null;
  }
  if (WORK_CALENDAR.includes(country)) {
    try {
      list = mergeWorkCalendar(year, list, await get(`https://xmlcalendar.ru/data/${country.toLowerCase()}/${year}/calendar.json`));
    } catch {
      /* без переносов — только праздники */
    }
  }
  return list;
}

function refresh(d: Database.Database, country: string, year: number): Promise<Holiday[] | null> {
  const key = `${country}-${year}`;
  const cur = running.get(key);
  if (cur) return cur;
  const p = fetchHolidays(country, year)
    .then((list) => {
      if (list) {
        d.prepare('insert or replace into holiday_cache (country, year, days, fetched_at) values (?, ?, ?, ?)').run(country, year, JSON.stringify(list), Date.now());
        failed.delete(key);
      } else failed.set(key, Date.now());
      return list;
    })
    .finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

export async function holidaysFor(d: Database.Database, country: string, year: number): Promise<Holiday[]> {
  const row = d.prepare('select days, fetched_at from holiday_cache where country = ? and year = ?').get(country, year) as { days: string; fetched_at: number } | undefined;
  const lastFail = failed.get(`${country}-${year}`) ?? 0;
  const mayTry = Date.now() - lastFail > RETRY_MS;
  if (row) {
    // Старое отдаём сразу, обновляем в фоне.
    if (Date.now() - row.fetched_at > FRESH_MS && mayTry) refresh(d, country, year).catch(() => undefined);
    try {
      return JSON.parse(row.days) as Holiday[];
    } catch {
      return [];
    }
  }
  if (!mayTry) return [];
  return (await refresh(d, country, year)) ?? [];
}

let countries: { at: number; list: { code: string }[] } | null = null;

/** Страны, для которых Nager знает праздники; не ответил — короткий список соседей. */
export async function holidayCountries(): Promise<string[]> {
  if (countries && Date.now() - countries.at < 24 * 60 * 60 * 1000) return countries.list.map((c) => c.code);
  try {
    const raw = (await get('https://date.nager.at/api/v3/AvailableCountries')) as { countryCode?: string }[];
    const list = (Array.isArray(raw) ? raw : []).map((c) => c.countryCode).filter((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c));
    if (list.length) {
      countries = { at: Date.now(), list: list.map((code) => ({ code })) };
      return list;
    }
  } catch {
    /* ниже — запасной список */
  }
  return ['RU', 'BY', 'KZ', 'UA', 'AM', 'GE', 'RS', 'ME', 'TR', 'DE', 'PL', 'LT', 'LV', 'EE', 'FI', 'CY', 'ES', 'IT', 'FR', 'GB', 'US', 'CA', 'IL'];
}
