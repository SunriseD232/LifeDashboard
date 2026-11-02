import { currency, isCurrency } from './currencies';
import { OP_KINDS, type OpKind } from './money';

/**
 * «Деньги»: проверка ответов ИИ (текст, голос, фото чека) и QR с чеков.
 * Модель только предлагает — человек смотрит черновик и сохраняет сам.
 */

/** Черновик операции: из быстрого ввода, голоса или ИИ. */
export interface MoneyDraft {
  kind?: OpKind;
  amount_minor?: number | null;
  /** Валюта суммы, если её назвали («12 €»). */
  currency?: string | null;
  payee?: string;
  day?: string;
  account_id?: string;
  category_id?: string | null;
  to_account_id?: string | null;
  to_amount_minor?: number | null;
  note?: string;
  source?: string;
  /** Что человек написал или сказал — показываем над черновиком. */
  said?: string;
}

export interface DraftItem {
  name: string;
  qty: number;
  unit: string | null;
  price_minor: number | null;
  total_minor: number;
  category_id: string | null;
}

export interface ReceiptDraft {
  payee: string;
  day: string;
  time: string | null;
  currency: string;
  total_minor: number;
  items: DraftItem[];
}

export interface AiContext {
  accounts: { id: string; name: string; currency: string; archived?: boolean }[];
  categories: { id: string; kind: 'expense' | 'income'; name: string }[];
  today: string;
  base: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 12.4 в валюте → 1240 минимальных единиц; не число или ≤ 0 — null. */
export function toMinor(v: unknown, code: string): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) return null;
  return Math.round(n * 10 ** currency(code).digits);
}

function code(v: unknown): string | null {
  const c = str(v, 6).toUpperCase();
  return isCurrency(c) ? c : null;
}

function findCategory(ctx: AiContext, name: unknown, kind: 'expense' | 'income'): string | null {
  const n = str(name, 60).toLowerCase();
  if (!n) return null;
  const list = ctx.categories.filter((c) => c.kind === kind);
  return (list.find((c) => c.name.toLowerCase() === n) ?? list.find((c) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n)))?.id ?? null;
}

function findAccount(ctx: AiContext, name: unknown, cur: string | null): string | undefined {
  const live = ctx.accounts.filter((a) => !a.archived);
  const n = str(name, 60).toLowerCase();
  if (n) {
    const hit = live.find((a) => a.name.toLowerCase() === n) ?? live.find((a) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()));
    if (hit) return hit.id;
  }
  return cur ? live.find((a) => a.currency === cur)?.id : undefined;
}

function day(v: unknown, today: string): string {
  const s = str(v, 10);
  // Будущее для траты почти всегда ошибка разбора — ставим сегодня.
  return DAY_RE.test(s) && s <= today ? s : today;
}

/** Ответ модели {"ops":[…]} → черновики операций (до 20). */
export function parseDrafts(raw: unknown, ctx: AiContext, said?: string): MoneyDraft[] {
  const list = (raw as { ops?: unknown })?.ops;
  if (!Array.isArray(list)) return [];
  const out: MoneyDraft[] = [];
  for (const r of list.slice(0, 20)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const kind = OP_KINDS.includes(o.kind as OpKind) ? (o.kind as OpKind) : 'expense';
    const cur = code(o.currency);
    const account_id = findAccount(ctx, o.account, cur);
    const accCur = ctx.accounts.find((a) => a.id === account_id)?.currency ?? ctx.base;
    const amount = toMinor(o.amount, cur ?? accCur);
    if (!amount) continue;
    const d: MoneyDraft = {
      kind,
      amount_minor: amount,
      currency: cur,
      day: day(o.date, ctx.today),
      account_id,
      payee: str(o.payee, 120),
      note: str(o.note, 300) || undefined,
      source: 'text',
      said,
    };
    if (kind === 'expense' || kind === 'income') d.category_id = findCategory(ctx, o.category, kind);
    if (kind === 'transfer' || kind === 'exchange') {
      const to = findAccount(ctx, o.to_account, code(o.to_currency));
      d.to_account_id = to && to !== account_id ? to : null;
      const toCur = ctx.accounts.find((a) => a.id === d.to_account_id)?.currency;
      d.to_amount_minor = kind === 'exchange' && toCur ? toMinor(o.to_amount, toCur) : null;
    }
    out.push(d);
  }
  return out;
}

const UNITS = new Set(['шт', 'кг', 'г', 'л', 'мл', 'м', 'уп']);

/**
 * Ответ модели о чеке → черновик. history — последняя категория по
 * нормализованному названию товара: прошлые правки человека важнее догадки ИИ.
 */
export function parseReceipt(raw: unknown, ctx: AiContext, history: (name: string) => string | null = () => null): ReceiptDraft | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cur = code(r.currency) ?? ctx.base;
  const items: DraftItem[] = [];
  for (const x of Array.isArray(r.items) ? r.items.slice(0, 300) : []) {
    const it = (x ?? {}) as Record<string, unknown>;
    const name = str(it.name, 200);
    const total = toMinor(it.total, cur);
    if (!name || !total) continue;
    const qtyN = Number(it.qty);
    const qty = Number.isFinite(qtyN) && qtyN > 0 && qtyN < 100000 ? Math.round(qtyN * 1000) / 1000 : 1;
    const unit = str(it.unit, 10).toLowerCase().replace(/\.$/, '');
    items.push({
      name,
      qty,
      unit: UNITS.has(unit) ? unit : null,
      price_minor: toMinor(it.price, cur),
      total_minor: total,
      category_id: history(name) ?? findCategory(ctx, it.category, 'expense'),
    });
  }
  const sum = items.reduce((s, i) => s + i.total_minor, 0);
  const total = toMinor(r.total, cur) ?? sum;
  if (!total) return null;
  const time = str(r.time, 5);
  return {
    payee: str(r.payee, 120),
    day: day(r.date, ctx.today),
    time: /^\d{2}:\d{2}$/.test(time) ? time : null,
    currency: cur,
    total_minor: total,
    items,
  };
}

/** Категория всего чека — та, на которую ушло больше денег. */
export function mainCategory(items: Pick<DraftItem, 'category_id' | 'total_minor'>[]): string | null {
  const by = new Map<string, number>();
  for (const i of items) if (i.category_id) by.set(i.category_id, (by.get(i.category_id) ?? 0) + i.total_minor);
  let best: string | null = null;
  for (const [id, n] of by) if (best === null || n > by.get(best)!) best = id;
  return best;
}

export interface FiscalQr {
  day: string;
  time: string;
  total_minor: number;
  /** 1 — покупка, 2 — возврат покупки (3, 4 — расход/возврат расхода продавца). */
  type: number;
}

/**
 * QR российского кассового чека: «t=20261030T1842&s=1477.60&fn=…&i=…&fp=…&n=1».
 * В нём только сумма и время; позиции по нему отдаёт ФНС (parseFnsReceipt),
 * а нет ключа сервиса — их читает ИИ с фото, QR проверяет сумму.
 * Чужой или не чековый QR — null.
 */
export function parseFiscalQr(text: string): FiscalQr | null {
  const p = new URLSearchParams(text.trim().replace(/^.*\?/, ''));
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(p.get('t') ?? '');
  const s = Number((p.get('s') ?? '').replace(',', '.'));
  if (!t || !(s > 0) || !p.get('fn')) return null;
  return { day: `${t[1]}-${t[2]}-${t[3]}`, time: `${t[4]}:${t[5]}`, total_minor: Math.round(s * 100), type: Number(p.get('n')) || 1 };
}

/**
 * Чек из ФНС по QR (через proverkacheka.com): {"code":1,"data":{"json":{…}}}.
 * Суммы в копейках, позиции — как их передала касса. Категории ставит
 * history (прошлые правки человека), остальное — ИИ потом. Не чек — null.
 */
export function parseFnsReceipt(raw: unknown, ctx: AiContext, history: (name: string) => string | null = () => null): ReceiptDraft | null {
  const r = (raw ?? {}) as { code?: unknown; data?: { json?: Record<string, unknown> } };
  const j = r.data?.json;
  if (r.code !== 1 || !j || typeof j !== 'object') return null;
  const kop = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
  const items: DraftItem[] = [];
  for (const x of Array.isArray(j.items) ? j.items.slice(0, 300) : []) {
    const it = (x ?? {}) as Record<string, unknown>;
    const name = str(it.name, 200).replace(/\s+/g, ' ');
    const total = kop(it.sum);
    if (!name || !total) continue;
    const q = Number(it.quantity);
    items.push({
      name,
      qty: Number.isFinite(q) && q > 0 && q < 100000 ? Math.round(q * 1000) / 1000 : 1,
      unit: FNS_UNITS[Number(it.itemsQuantityMeasure ?? it.measure)] ?? null,
      price_minor: kop(it.price),
      total_minor: total,
      category_id: history(name),
    });
  }
  const total = kop(j.totalSum) ?? items.reduce((s, i) => s + i.total_minor, 0);
  if (!total) return null;
  // dateTime: «2026-11-02T14:06:00» или секунды с 1970.
  const dt = typeof j.dateTime === 'number' ? new Date(j.dateTime * 1000 + 3 * 3600e3).toISOString() : str(j.dateTime, 30);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dt);
  return {
    // Интернет-заказ: retailPlace — адрес сайта («http://delivery.x5-digital.ru»), берём продавца.
    payee: shopName([str(j.retailPlace, 120), str(j.user, 120)].find((p) => p && !/^(https?:\/\/|www\.)|\.(ru|com|рф)/i.test(p)) ?? ''),
    day: day(m?.[1], ctx.today),
    time: m?.[2] ?? null,
    currency: 'RUB',
    total_minor: total,
    items,
  };
}

// Мера количества по ФФД 1.2: 0 — штуки, 11 — кг, 10 — г, 41 — л, 42 — мл.
const FNS_UNITS: Record<number, string> = { 0: 'шт', 10: 'г', 11: 'кг', 41: 'л', 42: 'мл' };

/** «ООО "АГРОТОРГ"» → «Агроторг»: без формы собственности и кавычек. */
export function shopName(s: string): string {
  const t = s
    .replace(/^(ооо|оао|зао|пао|ао|ип|llc)\s+/i, '')
    .replace(/["«»]/g, '')
    .trim();
  if (!t) return '';
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : t;
}

/** Простую строку («кофе 350») разбираем сами, сложную — ИИ. */
export function needsAi(text: string, amountFound: boolean): boolean {
  // «1 200» — одно число с пробелом тысяч, а не два.
  const numbers = text.replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1').match(/\d+([.,]\d+)?/g)?.length ?? 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  return !amountFound || numbers > 1 || words > 4 || /\s(и|плюс|ещё|еще)\s/i.test(text);
}
