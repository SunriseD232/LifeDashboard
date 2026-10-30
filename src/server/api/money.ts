import { randomUUID } from 'node:crypto';
import { userLogin } from '@/lib/auth';
import { isCurrency } from '@/lib/currencies';
import { ACCOUNT_KINDS, MODULES, normItem, OP_KINDS, type MoneyState, type OpKind } from '@/lib/money';
import { householdOf } from '../household';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import {
  moneyAllowed,
  readAccounts,
  readCategories,
  readItems,
  readMoneySettings,
  readOps,
  readUserRates,
  seedCategories,
  visibleAccount,
  visibleOp,
} from '../moneyStore';
import { refreshRates, todayRates } from '../moneyRates';

const MONTH_RE = /^\d{4}-\d{2}$/;

/** Сумма в минимальных единицах: целое > 0 (или ≥ 0, если zero). */
function minor(v: unknown, field: string, zero = false): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || (!zero && n === 0)) throw new HttpError(400, `Неверная сумма: «${field}».`);
  return n;
}

function signedMinor(v: unknown, field: string): number {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new HttpError(400, `Неверная сумма: «${field}».`);
  return n;
}

function currencyCode(v: unknown): string {
  if (!isCurrency(v)) throw new HttpError(400, 'Неизвестная валюта.');
  return v;
}

function currencyList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 60) throw new HttpError(400, 'Неверный список валют.');
  return [...new Set(v.map(currencyCode))];
}

function settingsRequired(d: Ctx['d'], userId: string) {
  const s = readMoneySettings(d, userId);
  if (!s) throw new HttpError(409, 'Сначала выберите валюты.');
  return s;
}

/** Своя категория нужного вида — её id, иначе null. */
function ownCategory(d: Ctx['d'], userId: string, id: unknown, kind: 'expense' | 'income'): string | null {
  if (id === null || id === undefined || id === '') return null;
  const row = d.prepare('select id from money_categories where id = ? and user_id = ? and kind = ?').get(id, userId, kind) as { id: string } | undefined;
  if (!row) throw new HttpError(400, 'Нет такой категории.');
  return row.id;
}

/** Валюту стали использовать — добавить её в список человека. */
function rememberCurrency(d: Ctx['d'], userId: string, code: string) {
  const s = readMoneySettings(d, userId);
  if (s && code !== s.base_currency && !s.currencies.includes(code)) {
    d.prepare('update money_settings set currencies = ? where user_id = ?').run(JSON.stringify([...s.currencies, code]), userId);
  }
}

interface ItemIn {
  name: string;
  qty: number;
  unit: string | null;
  price_minor: number | null;
  total_minor: number;
  category_id: string | null;
}

function items(d: Ctx['d'], userId: string, v: unknown): ItemIn[] {
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
function opFields(d: Ctx['d'], userId: string, body: Record<string, unknown>, keepCategory: string | null = null) {
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

function saveItems(d: Ctx['d'], opId: string, list: ItemIn[]) {
  d.prepare('delete from money_items where op_id = ?').run(opId);
  const add = d.prepare(
    'insert into money_items (id, op_id, position, name, norm_name, qty, unit, price_minor, total_minor, category_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  list.forEach((it, i) => add.run(randomUUID(), opId, i, it.name, normItem(it.name) || null, it.qty, it.unit, it.price_minor, it.total_minor, it.category_id));
}

function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

/**
 * «Деньги»: /api/money/<раздел>[/<id>].
 *  GET    state?month=YYYY-MM       — всё для экрана;
 *  POST   onboard { base_currency, currencies, account? } — первый запуск;
 *  PATCH  settings { base_currency?, currencies?, hidden? };
 *  POST   accounts { name, kind, currency, opening_minor, shared } / PATCH accounts/:id / DELETE accounts/:id;
 *  POST   ops { kind, day, account_id, amount_minor, to_account_id?, to_amount_minor?, orig_*?, category_id?, payee?, note?, items? };
 *  GET    ops/:id — с позициями; PATCH ops/:id; DELETE ops/:id;
 *  POST   categories { kind, name } / PATCH categories/:id { name?, archived? };
 *  POST   rates { currency, rate } — свой курс для валюты без курса ЦБ.
 * Пока раздел тестовый — только для MONEY_USERS (src/server/moneyStore.ts).
 */
export async function money({ d, userId, method, body, id: sub, action: id, req }: Ctx): Promise<unknown> {
  const login = userLogin(userId);
  if (!moneyAllowed(userId, login)) throw new HttpError(403, 'Раздел «Деньги» пока в тесте и открыт не всем.');

  if (sub === 'state' && method === 'GET') {
    const month = req.nextUrl.searchParams.get('month') ?? '';
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'Неверный месяц.');
    // Курсы на сегодня — подождём недолго, иначе отдадим вчерашние.
    await Promise.race([refreshRates(d), new Promise((r) => setTimeout(r, 2500))]);
    const { rates, day } = todayRates(d);
    const [from, to] = monthRange(month);
    const state: MoneyState = {
      settings: readMoneySettings(d, userId),
      accounts: readAccounts(d, userId),
      categories: readCategories(d, userId),
      ops: readOps(d, userId, from, to),
      month,
      rates: { ...rates, RUB: 1 },
      rates_day: day,
      user_rates: readUserRates(d, userId),
      family: !!householdOf(d, userId),
      login,
    };
    return state;
  }

  if (sub === 'onboard' && method === 'POST') {
    const base = currencyCode(body.base_currency);
    const list = currencyList(body.currencies ?? []).filter((c) => c !== base);
    d.transaction(() => {
      d.prepare(
        `insert into money_settings (user_id, base_currency, currencies) values (?, ?, ?)
         on conflict (user_id) do update set base_currency = excluded.base_currency, currencies = excluded.currencies`,
      ).run(userId, base, JSON.stringify(list));
      seedCategories(d, userId);
      // Первый счёт — чтобы сразу можно было записать трату.
      if (!d.prepare('select 1 from money_accounts where user_id = ? limit 1').get(userId)) {
        const a = (body.account ?? {}) as Record<string, unknown>;
        d.prepare('insert into money_accounts (id, user_id, name, kind, currency, opening_minor) values (?, ?, ?, ?, ?, ?)').run(
          randomUUID(),
          userId,
          text(a.name, 60, 'Название счёта', true) ?? 'Карта',
          'card',
          a.currency ? currencyCode(a.currency) : base,
          signedMinor(a.opening_minor, 'Остаток'),
        );
      }
    })();
    return { ok: true };
  }

  if (sub === 'settings' && method === 'PATCH') {
    const s = settingsRequired(d, userId);
    const base = body.base_currency !== undefined ? currencyCode(body.base_currency) : s.base_currency;
    const list = (body.currencies !== undefined ? currencyList(body.currencies) : s.currencies).filter((c) => c !== base);
    let hidden = s.hidden;
    if (body.hidden !== undefined) {
      if (!Array.isArray(body.hidden)) throw new HttpError(400, 'Неверный список.');
      const known = new Set(MODULES.map((m) => m.id));
      hidden = [...new Set((body.hidden as unknown[]).filter((h): h is string => typeof h === 'string' && known.has(h)))];
    }
    d.prepare('update money_settings set base_currency = ?, currencies = ?, hidden = ? where user_id = ?').run(base, JSON.stringify(list), JSON.stringify(hidden), userId);
    return { ok: true };
  }

  if (sub === 'accounts') {
    settingsRequired(d, userId);
    if (method === 'POST' && !id) {
      const kind = ACCOUNT_KINDS.some((k) => k.id === body.kind) ? body.kind : 'card';
      const cur = currencyCode(body.currency);
      const hh = body.shared ? householdOf(d, userId) : null;
      if (body.shared && !hh) throw new HttpError(400, 'Семейный счёт можно завести, когда вы в семье (Настройки LifeDashboard → Семья).');
      const pos = ((d.prepare('select max(position) as m from money_accounts where user_id = ?').get(userId) as { m: number | null }).m ?? -1) + 1;
      const aid = randomUUID();
      d.prepare('insert into money_accounts (id, user_id, household_id, name, kind, currency, opening_minor, position) values (?, ?, ?, ?, ?, ?, ?, ?)').run(
        aid,
        userId,
        hh,
        text(body.name, 60, 'Название счёта'),
        kind,
        cur,
        signedMinor(body.opening_minor, 'Остаток'),
        pos,
      );
      rememberCurrency(d, userId, cur);
      return { id: aid };
    }
    const acc = d.prepare('select * from money_accounts where id = ? and user_id = ?').get(id ?? '', userId) as { id: string; currency: string } | undefined;
    if (!acc) throw new HttpError(visibleAccount(d, userId, id) ? 403 : 404, visibleAccount(d, userId, id) ? 'Менять семейный счёт может тот, кто его завёл.' : 'Счёт не найден.');
    if (method === 'PATCH') {
      if (body.name !== undefined) d.prepare('update money_accounts set name = ? where id = ?').run(text(body.name, 60, 'Название счёта'), acc.id);
      if (body.kind !== undefined && ACCOUNT_KINDS.some((k) => k.id === body.kind)) d.prepare('update money_accounts set kind = ? where id = ?').run(body.kind, acc.id);
      if (body.opening_minor !== undefined) d.prepare('update money_accounts set opening_minor = ? where id = ?').run(signedMinor(body.opening_minor, 'Остаток'), acc.id);
      if (body.archived !== undefined) d.prepare('update money_accounts set archived = ? where id = ?').run(body.archived ? 1 : 0, acc.id);
      if (body.shared !== undefined) {
        const hh = body.shared ? householdOf(d, userId) : null;
        if (body.shared && !hh) throw new HttpError(400, 'Семейный счёт можно завести, когда вы в семье.');
        d.prepare('update money_accounts set household_id = ? where id = ?').run(hh, acc.id);
      }
      if (body.currency !== undefined && body.currency !== acc.currency) {
        const used = d.prepare('select 1 from money_ops where account_id = ? or to_account_id = ? limit 1').get(acc.id, acc.id);
        if (used) throw new HttpError(400, 'На счёте уже есть операции — валюту не поменять. Заведите новый счёт.');
        const cur = currencyCode(body.currency);
        d.prepare('update money_accounts set currency = ? where id = ?').run(cur, acc.id);
        rememberCurrency(d, userId, cur);
      }
      return { ok: true };
    }
    if (method === 'DELETE') {
      const used = d.prepare('select 1 from money_ops where account_id = ? or to_account_id = ? limit 1').get(acc.id, acc.id);
      if (used) throw new HttpError(400, 'На счёте есть операции — его можно только убрать в архив.');
      d.prepare('delete from money_accounts where id = ?').run(acc.id);
      return { ok: true };
    }
  }

  if (sub === 'ops') {
    settingsRequired(d, userId);
    if (method === 'POST' && !id) {
      const f = opFields(d, userId, body);
      const list = items(d, userId, body.items);
      const source = ['manual', 'text', 'voice', 'photo', 'import', 'sms'].includes(body.source) ? body.source : 'manual';
      const oid = randomUUID();
      d.transaction(() => {
        d.prepare(
          `insert into money_ops (id, user_id, kind, day, account_id, amount_minor, currency, to_account_id, to_amount_minor, to_currency,
             orig_amount_minor, orig_currency, category_id, payee, note, source)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(oid, userId, f.kind, f.day, f.account_id, f.amount_minor, f.currency, f.to_account_id, f.to_amount_minor, f.to_currency, f.orig_amount_minor, f.orig_currency, f.category_id, f.payee, f.note, source);
        if (list.length) saveItems(d, oid, list);
      })();
      return { id: oid };
    }
    const op = visibleOp(d, userId, id);
    if (!op) throw new HttpError(404, 'Операция не найдена.');
    if (method === 'GET') return { items: readItems(d, op.id) };
    if (method === 'PATCH') {
      const f = opFields(d, userId, body, op.category_id);
      d.transaction(() => {
        d.prepare(
          `update money_ops set kind = ?, day = ?, account_id = ?, amount_minor = ?, currency = ?, to_account_id = ?, to_amount_minor = ?,
             to_currency = ?, orig_amount_minor = ?, orig_currency = ?, category_id = ?, payee = ?, note = ?, updated_at = datetime('now')
           where id = ?`,
        ).run(f.kind, f.day, f.account_id, f.amount_minor, f.currency, f.to_account_id, f.to_amount_minor, f.to_currency, f.orig_amount_minor, f.orig_currency, f.category_id, f.payee, f.note, op.id);
        if (body.items !== undefined) saveItems(d, op.id, items(d, userId, body.items));
      })();
      return { ok: true };
    }
    if (method === 'DELETE') {
      d.prepare('delete from money_ops where id = ?').run(op.id);
      return { ok: true };
    }
  }

  if (sub === 'categories') {
    settingsRequired(d, userId);
    if (method === 'POST' && !id) {
      const kind = body.kind === 'income' ? 'income' : 'expense';
      const name = text(body.name, 40, 'Категория') as string;
      const pos = ((d.prepare('select max(position) as m from money_categories where user_id = ? and kind = ?').get(userId, kind) as { m: number | null }).m ?? -1) + 1;
      const cid = randomUUID();
      d.prepare('insert into money_categories (id, user_id, kind, name, position) values (?, ?, ?, ?, ?)').run(cid, userId, kind, name, pos);
      return { id: cid };
    }
    const cat = d.prepare('select id from money_categories where id = ? and user_id = ?').get(id ?? '', userId) as { id: string } | undefined;
    if (!cat) throw new HttpError(404, 'Категория не найдена.');
    if (method === 'PATCH') {
      if (body.name !== undefined) d.prepare('update money_categories set name = ? where id = ?').run(text(body.name, 40, 'Категория'), cat.id);
      // Удалить нельзя — в операциях останется ссылка; убираем из списков.
      if (body.archived !== undefined) d.prepare('update money_categories set archived = ? where id = ?').run(body.archived ? 1 : 0, cat.id);
      return { ok: true };
    }
  }

  if (sub === 'rates' && method === 'POST') {
    const cur = currencyCode(body.currency);
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) throw new HttpError(400, 'Неверный курс.');
    d.prepare(
      `insert into money_user_rates (user_id, currency, rate) values (?, ?, ?)
       on conflict (user_id, currency) do update set rate = excluded.rate, updated_at = datetime('now')`,
    ).run(userId, cur, rate);
    return { ok: true };
  }

  return undefined;
}
