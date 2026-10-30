import { randomUUID } from 'node:crypto';
import { isCurrency } from '@/lib/currencies';
import { normItem, OP_KINDS, type OpKind } from '@/lib/money';
import { DAY_RE, HttpError, text, type Ctx } from './http';
import { readMoneySettings, visibleAccount } from './moneyStore';

/**
 * Проверка и запись операций «Денег» — общие для ручного ввода, импорта,
 * регулярных платежей, долгов и SMS.
 */

/** Сумма в минимальных единицах: целое > 0 (или ≥ 0, если zero). */
export function minor(v: unknown, field: string, zero = false): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || (!zero && n === 0)) throw new HttpError(400, `Неверная сумма: «${field}».`);
  return n;
}

export function signedMinor(v: unknown, field: string): number {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new HttpError(400, `Неверная сумма: «${field}».`);
  return n;
}

export function currencyCode(v: unknown): string {
  if (!isCurrency(v)) throw new HttpError(400, 'Неизвестная валюта.');
  return v;
}

export function currencyList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 60) throw new HttpError(400, 'Неверный список валют.');
  return [...new Set(v.map(currencyCode))];
}

export function settingsRequired(d: Ctx['d'], userId: string) {
  const s = readMoneySettings(d, userId);
  if (!s) throw new HttpError(409, 'Сначала выберите валюты.');
  return s;
}

/** Своя категория нужного вида — её id, иначе null. */
export function ownCategory(d: Ctx['d'], userId: string, id: unknown, kind: 'expense' | 'income'): string | null {
  if (id === null || id === undefined || id === '') return null;
  const row = d.prepare('select id from money_categories where id = ? and user_id = ? and kind = ?').get(id, userId, kind) as { id: string } | undefined;
  if (!row) throw new HttpError(400, 'Нет такой категории.');
  return row.id;
}

/** Валюту стали использовать — добавить её в список человека. */
export function rememberCurrency(d: Ctx['d'], userId: string, code: string) {
  const s = readMoneySettings(d, userId);
  if (s && code !== s.base_currency && !s.currencies.includes(code)) {
    d.prepare('update money_settings set currencies = ? where user_id = ?').run(JSON.stringify([...s.currencies, code]), userId);
  }
}

export interface ItemIn {
  name: string;
  qty: number;
  unit: string | null;
  price_minor: number | null;
  total_minor: number;
  category_id: string | null;
}

export function items(d: Ctx['d'], userId: string, v: unknown): ItemIn[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 300) throw new HttpError(400, 'Неверный список позиций.');
  return v.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const qty = it.qty === undefined || it.qty === null || it.qty === '' ? 1 : Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) throw new HttpError(400, 'Неверное количество в позиции.');
    return {
      name: text(it.name, 200, 'Позиция') as string,
      qty,
      unit: text(it.unit, 10, 'Единица', true),
      price_minor: it.price_minor === undefined || it.price_minor === null ? null : minor(it.price_minor, 'Цена', true),
      total_minor: minor(it.total_minor, 'Сумма позиции', true),
      category_id: ownCategory(d, userId, it.category_id, 'expense'),
    };
  });
}

/** Поля операции из тела запроса — проверенные и с валютами счетов. */
export function opFields(d: Ctx['d'], userId: string, body: Record<string, unknown>, keepCategory: string | null = null) {
  const kind = body.kind as OpKind;
  if (!OP_KINDS.includes(kind)) throw new HttpError(400, 'Неверный тип операции.');
  if (typeof body.day !== 'string' || !DAY_RE.test(body.day)) throw new HttpError(400, 'Неверная дата.');
  const acc = visibleAccount(d, userId, body.account_id);
  if (!acc) throw new HttpError(400, 'Нет такого счёта.');
  const amount = minor(body.amount_minor, 'Сумма');
  let to: { id: string; currency: string } | null = null;
  let toAmount: number | null = null;
  if (kind === 'transfer' || kind === 'exchange') {
    const t = visibleAccount(d, userId, body.to_account_id);
    if (!t) throw new HttpError(400, 'Выберите счёт, куда пришли деньги.');
    if (t.id === acc.id) throw new HttpError(400, 'Счета «откуда» и «куда» должны быть разными.');
    to = t;
    if (kind === 'transfer') {
      if (t.currency !== acc.currency) throw new HttpError(400, 'У счетов разные валюты — это обмен, а не перевод.');
      toAmount = amount;
    } else {
      if (t.currency === acc.currency) throw new HttpError(400, 'У счетов одна валюта — это перевод, а не обмен.');
      toAmount = minor(body.to_amount_minor, 'Получено');
    }
  }
  let orig: { minor: number; currency: string } | null = null;
  if ((kind === 'expense' || kind === 'income') && body.orig_currency && body.orig_currency !== acc.currency) {
    orig = { minor: minor(body.orig_amount_minor, 'Сумма в валюте покупки'), currency: currencyCode(body.orig_currency) };
  }
  const catKind = kind === 'income' ? 'income' : 'expense';
  return {
    kind,
    day: body.day,
    account_id: acc.id,
    amount_minor: amount,
    currency: acc.currency,
    to_account_id: to?.id ?? null,
    to_amount_minor: toAmount,
    to_currency: to?.currency ?? null,
    orig_amount_minor: orig?.minor ?? null,
    orig_currency: orig?.currency ?? null,
    // Семейную операцию могут править все в семье — её категория может быть
    // не своей: оставляем как есть.
    category_id: kind === 'expense' || kind === 'income' ? (keepCategory && body.category_id === keepCategory ? keepCategory : ownCategory(d, userId, body.category_id, catKind)) : null,
    payee: text(body.payee, 120, 'Где', true),
    note: text(body.note, 2000, 'Заметка', true),
  };
}

export function saveItems(d: Ctx['d'], opId: string, list: ItemIn[]) {
  d.prepare('delete from money_items where op_id = ?').run(opId);
  const add = d.prepare(
    'insert into money_items (id, op_id, position, name, norm_name, qty, unit, price_minor, total_minor, category_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  list.forEach((it, i) => add.run(randomUUID(), opId, i, it.name, normItem(it.name) || null, it.qty, it.unit, it.price_minor, it.total_minor, it.category_id));
}

export type OpFields = ReturnType<typeof opFields>;

/** Записать проверенную операцию. extra — откуда она (source) и связи (импорт, долг). */
export function insertOp(
  d: Ctx['d'],
  userId: string,
  f: OpFields,
  extra: { source: string; import_key?: string | null; debt_id?: string | null; items?: ItemIn[] },
): string {
  const id = randomUUID();
  d.prepare(
    `insert into money_ops (id, user_id, kind, day, account_id, amount_minor, currency, to_account_id, to_amount_minor, to_currency,
       orig_amount_minor, orig_currency, category_id, payee, note, source, import_key, debt_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, f.kind, f.day, f.account_id, f.amount_minor, f.currency, f.to_account_id, f.to_amount_minor, f.to_currency, f.orig_amount_minor, f.orig_currency, f.category_id, f.payee, f.note, extra.source, extra.import_key ?? null, extra.debt_id ?? null);
  if (extra.items?.length) saveItems(d, id, extra.items);
  return id;
}
