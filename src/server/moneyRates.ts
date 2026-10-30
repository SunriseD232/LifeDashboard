import type Database from 'better-sqlite3';

/**
 * Курсы ЦБ для «Денег»: сколько рублей за 1 единицу валюты.
 *
 * Источник — официальный XML ЦБ (cbr.ru/scripts/XML_daily.asp). Сайт ЦБ
 * бывает недоступен из-за границы — тогда зеркало cbr-xml-daily.ru с теми же
 * данными в JSON. Курсы хранятся в money_rates по дням: экран берёт
 * последний, а прошлые дни остаются для отчётов.
 */

export interface CbrRates {
  /** День, на который ЦБ установил курсы, YYYY-MM-DD. */
  day: string;
  /** Рублей за 1 единицу (номинал уже учтён). */
  rates: Record<string, number>;
}

/** «81,6000» за номинал 100 → за 1 единицу. */
function perUnit(value: string | number, nominal: string | number): number | null {
  const v = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  const n = Number(nominal);
  return Number.isFinite(v) && v > 0 && Number.isFinite(n) && n > 0 ? v / n : null;
}

/** Разбор XML_daily.asp: <ValCurs Date="30.10.2026"><Valute>…<CharCode>USD</CharCode><Nominal>1</Nominal><Value>81,6000</Value>… */
export function parseCbrXml(xml: string): CbrRates | null {
  const date = /<ValCurs[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!date) return null;
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const code = /<CharCode>([A-Z]{3})<\/CharCode>/.exec(m[1])?.[1];
    const nominal = /<Nominal>(\d+)<\/Nominal>/.exec(m[1])?.[1];
    const value = /<Value>([\d,.]+)<\/Value>/.exec(m[1])?.[1];
    const rate = code && nominal && value ? perUnit(value, nominal) : null;
    if (code && rate) rates[code] = rate;
  }
  return Object.keys(rates).length ? { day: `${date[3]}-${date[2]}-${date[1]}`, rates } : null;
}

/** Разбор зеркала: { Date: "2026-10-30T11:30:00+03:00", Valute: { USD: { Nominal: 1, Value: 81.6 } } }. */
export function parseCbrJson(json: unknown): CbrRates | null {
  const j = json as { Date?: string; Valute?: Record<string, { CharCode?: string; Nominal?: number; Value?: number }> };
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(j?.Date ?? '')?.[1];
  if (!day || !j.Valute) return null;
  const rates: Record<string, number> = {};
  for (const [code, v] of Object.entries(j.Valute)) {
    const rate = perUnit(v?.Value ?? NaN, v?.Nominal ?? NaN);
    if (/^[A-Z]{3}$/.test(code) && rate) rates[code] = rate;
  }
  return Object.keys(rates).length ? { day, rates } : null;
}

type Transport = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

let transport: Transport = (url) => fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });

/** Для тестов: подменить сеть. */
export function setRatesTransport(t: Transport) {
  transport = t;
}

/** Последние курсы ЦБ: сначала сам ЦБ, не вышло — зеркало. Ничего — null. */
export async function fetchCbr(): Promise<CbrRates | null> {
  try {
    const res = await transport('https://www.cbr.ru/scripts/XML_daily.asp');
    if (res.ok) {
      const parsed = parseCbrXml(await res.text());
      if (parsed) return parsed;
    }
  } catch {
    /* ниже — зеркало */
  }
  try {
    const res = await transport('https://www.cbr-xml-daily.ru/daily_json.js');
    if (res.ok) return parseCbrJson(JSON.parse(await res.text()));
  } catch {
    /* оба источника молчат — курсы останутся вчерашними */
  }
  return null;
}

export function saveRates(d: Database.Database, r: CbrRates) {
  const put = d.prepare('insert or replace into money_rates (day, currency, rate) values (?, ?, ?)');
  d.transaction(() => {
    for (const [code, rate] of Object.entries(r.rates)) put.run(r.day, code, rate);
  })();
}

/** Последний известный курс каждой валюты не позже дня day (по умолчанию — любой). */
export function latestRates(d: Database.Database, day = '9999-12-31'): { rates: Record<string, number>; day: string | null } {
  const rows = d
    .prepare(
      `select currency, rate, day from money_rates
       where (currency, day) in (select currency, max(day) from money_rates where day <= ? group by currency)`,
    )
    .all(day) as { currency: string; rate: number; day: string }[];
  const rates: Record<string, number> = {};
  let last: string | null = null;
  for (const r of rows) {
    rates[r.currency] = r.rate;
    if (!last || r.day > last) last = r.day;
  }
  return { rates, day: last };
}

// Обновляем не чаще раза в 3 часа на процесс — и не ждём, если уже идёт.
const REFRESH_MS = 3 * 60 * 60 * 1000;
let lastTry = 0;
let running: Promise<void> | null = null;

/** Сегодня по Москве — курсы ЦБ устанавливает по ней. */
export function moscowDay(now = Date.now()): string {
  return new Date(now + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Курсы на сегодня. После обеда ЦБ уже выкладывает завтрашние — их не берём,
 * пока не наступил их день; валюте без сегодняшнего курса — какой есть.
 */
export function todayRates(d: Database.Database, now = Date.now()): { rates: Record<string, number>; day: string | null } {
  const today = latestRates(d, moscowDay(now));
  const any = latestRates(d);
  return { rates: { ...any.rates, ...today.rates }, day: today.day ?? any.day };
}

/** Курсы на сегодня (по Москве) есть — ничего; нет — загрузить. Ошибки глушит. */
export function refreshRates(d: Database.Database, now = Date.now()): Promise<void> {
  const today = moscowDay(now);
  const have = d.prepare('select 1 from money_rates where day >= ? limit 1').get(today);
  if (have || running || now - lastTry < REFRESH_MS) return running ?? Promise.resolve();
  lastTry = now;
  running = fetchCbr()
    .then((r) => {
      if (r) saveRates(d, r);
    })
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  return running;
}

/** Для тестов: забыть, когда пробовали. */
export function resetRatesClock() {
  lastTry = 0;
  running = null;
}
