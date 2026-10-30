import { currency } from './currencies';

/**
 * «Деньги»: расчёты для отчётов — периоды, курсы на день операции, траты по
 * категориям с учётом позиций чека и цены товаров. Без базы — легко
 * проверить тестами; данные даёт src/server/moneyReport.ts.
 */

export type Period = 'week' | 'month' | 'year';
export const PERIODS: Period[] = ['week', 'month', 'year'];

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

export interface Range {
  from: string;
  to: string;
  /** Подпись столбика: «окт», «2026», «27 окт». */
  short: string;
  /** Заголовок: «Октябрь 2026», «27 окт – 2 нояб». */
  title: string;
}

/** Период, в который попадает день anchor; n — сдвиг на n периодов. Неделя — с понедельника. */
export function periodRange(period: Period, anchor: string, n = 0): Range {
  const a = utc(anchor);
  if (period === 'year') {
    const y = a.getUTCFullYear() + n;
    return { from: `${y}-01-01`, to: `${y}-12-31`, short: String(y), title: String(y) };
  }
  if (period === 'month') {
    const s = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + n, 1));
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    const name = MONTHS[s.getUTCMonth()];
    return { from: iso(s), to: iso(e), short: MONTHS_SHORT[s.getUTCMonth()], title: `${name[0].toUpperCase()}${name.slice(1)} ${s.getUTCFullYear()}` };
  }
  const monday = new Date(a.getTime() - ((a.getUTCDay() + 6) % 7) * 864e5 + n * 7 * 864e5);
  const sunday = new Date(monday.getTime() + 6 * 864e5);
  const fmt = (d: Date) => `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
  return { from: iso(monday), to: iso(sunday), short: fmt(monday), title: `${fmt(monday)} – ${fmt(sunday)}` };
}

/**
 * Курсы по дням: рублей за 1 единицу на день операции (последний известный
 * не позже неё; раньше первого — первый). Нет курса ЦБ — свой курс человека.
 */
export class RateBook {
  private byCur = new Map<string, { day: string; rate: number }[]>();
  constructor(
    rows: { day: string; currency: string; rate: number }[],
    private own: Record<string, number> = {},
  ) {
    for (const r of rows) {
      const list = this.byCur.get(r.currency) ?? [];
      list.push({ day: r.day, rate: r.rate });
      this.byCur.set(r.currency, list);
    }
    for (const list of this.byCur.values()) list.sort((x, y) => (x.day < y.day ? -1 : 1));
  }

  rate(code: string, day: string): number | null {
    if (code === 'RUB') return 1;
    const list = this.byCur.get(code);
    if (!list?.length) return this.own[code] ?? null;
    let lo = 0;
    let hi = list.length - 1;
    if (day < list[0].day) return list[0].rate;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid].day <= day) lo = mid;
      else hi = mid - 1;
    }
    return list[lo].rate;
  }

  /** Сумма в основной валюте на день; нет курса — null. */
  convert(minor: number, from: string, to: string, day: string): number | null {
    if (from === to) return minor;
    const rf = this.rate(from, day);
    const rt = this.rate(to, day);
    if (!rf || !rt) return null;
    return Math.round(((minor / 10 ** currency(from).digits) * rf * 10 ** currency(to).digits) / rt);
  }
}

export interface SpendOp {
  id: string;
  kind: string;
  day: string;
  amount_minor: number;
  currency: string;
  category_id: string | null;
}

export interface SpendItem {
  category_id: string | null;
  total_minor: number;
}

export interface Part {
  op_id: string;
  category_id: string | null;
  base_minor: number;
}

/**
 * Трата в основной валюте по категориям. Чек с позициями делим по категориям
 * позиций пропорционально их суммам («Продукты» 1 168 и «Бытовая химия» 309
 * в одном чеке), позиция без категории — в категорию операции. Копейки
 * округления — последней части, чтобы сумма сходилась.
 */
export function spendParts(op: SpendOp, items: SpendItem[], book: RateBook, base: string): Part[] {
  const total = book.convert(op.amount_minor, op.currency, base, op.day);
  if (total === null) return [];
  const sum = items.reduce((s, i) => s + i.total_minor, 0);
  if (!items.length || sum <= 0) return [{ op_id: op.id, category_id: op.category_id, base_minor: total }];
  const by = new Map<string | null, number>();
  for (const i of items) {
    const c = i.category_id ?? op.category_id;
    by.set(c, (by.get(c) ?? 0) + i.total_minor);
  }
  const parts: Part[] = [];
  let left = total;
  const entries = [...by];
  entries.forEach(([c, n], k) => {
    const v = k === entries.length - 1 ? left : Math.round((total * n) / sum);
    left -= v;
    parts.push({ op_id: op.id, category_id: c, base_minor: v });
  });
  return parts;
}

// ---------------------------------------------------------------- цены

export interface PriceRow {
  norm_name: string;
  name: string;
  qty: number;
  unit: string | null;
  price_minor: number | null;
  total_minor: number;
  day: string;
  payee: string | null;
  currency: string;
}

export interface PriceStat {
  key: string;
  name: string;
  unit: string | null;
  currency: string;
  count: number;
  first: { day: string; price: number };
  last: { day: string; price: number; payee: string | null };
  min: number;
  /** Изменение от первой цены к последней, %; одна покупка — null. */
  change: number | null;
}

/** Цена за единицу: за штуку или за кг/л, если товар весовой. */
export function unitPrice(r: Pick<PriceRow, 'qty' | 'price_minor' | 'total_minor'>): number {
  return r.price_minor ?? Math.round(r.total_minor / (r.qty > 0 ? r.qty : 1));
}

const priceKey = (r: Pick<PriceRow, 'norm_name' | 'currency' | 'unit'>) => `${r.norm_name}|${r.currency}|${r.unit === 'кг' || r.unit === 'л' ? r.unit : 'шт'}`;

/**
 * Товары из чеков: как менялась цена. Сначала те, что подорожали или
 * подешевели сильнее всего (куплены хотя бы дважды), потом остальные — по
 * свежести.
 */
export function priceStats(rows: PriceRow[], q = ''): PriceStat[] {
  const groups = new Map<string, PriceRow[]>();
  const needle = q.trim().toLowerCase().replace(/ё/g, 'е');
  for (const r of rows) {
    if (!r.norm_name || (needle && !r.norm_name.includes(needle) && !r.name.toLowerCase().includes(needle))) continue;
    const k = priceKey(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const out: PriceStat[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const first = list[0];
    const last = list[list.length - 1];
    const fp = unitPrice(first);
    const lp = unitPrice(last);
    out.push({
      key,
      name: last.name,
      unit: last.unit === 'кг' || last.unit === 'л' ? last.unit : null,
      currency: last.currency,
      count: list.length,
      first: { day: first.day, price: fp },
      last: { day: last.day, price: lp, payee: last.payee },
      min: Math.min(...list.map(unitPrice)),
      change: list.length > 1 && fp > 0 && first.day !== last.day ? Math.round(((lp - fp) / fp) * 1000) / 10 : null,
    });
  }
  return out.sort((a, b) => {
    if ((a.change === null) !== (b.change === null)) return a.change === null ? 1 : -1;
    if (a.change !== null && b.change !== null && Math.abs(b.change) !== Math.abs(a.change)) return Math.abs(b.change) - Math.abs(a.change);
    return a.last.day < b.last.day ? 1 : -1;
  });
}

/** История одного товара: покупки по порядку. */
export function priceHistory(rows: PriceRow[], key: string): (PriceRow & { unit_price: number })[] {
  return rows
    .filter((r) => priceKey(r) === key)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((r) => ({ ...r, unit_price: unitPrice(r) }));
}
