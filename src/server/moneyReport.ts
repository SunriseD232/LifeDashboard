import type Database from 'better-sqlite3';
import { formatMinor } from '@/lib/currencies';
import { periodRange, priceHistory, priceStats, RateBook, spendParts, type Part, type Period, type PriceRow } from '@/lib/moneyReport';
import { askJson } from './ai';
import { HttpError, text } from './http';
import { householdOf } from './household';
import { readAccounts, readCategories, readItemPrices, readMoneySettings, readOps, readUserRates } from './moneyStore';

/**
 * Отчёты «Денег»: траты и доходы за период в основной валюте (по курсу на
 * день операции), по категориям с учётом позиций чеков, бюджеты, цены
 * товаров и вопросы к ИИ о своих деньгах.
 */

export type Scope = 'mine' | 'family' | 'all';

function book(d: Database.Database, userId: string): RateBook {
  const rows = d.prepare('select day, currency, rate from money_rates').all() as { day: string; currency: string; rate: number }[];
  return new RateBook(rows, readUserRates(d, userId));
}

interface Flow {
  /** Части трат по категориям (чек — по позициям). */
  parts: Part[];
  income: { op_id: string; category_id: string | null; base_minor: number; day: string }[];
  /** День и получатель трат — для столбиков и «где больше всего». */
  ops: Map<string, { day: string; payee: string | null; shared: boolean }>;
  /** Валюты, для которых нет курса: такие операции не посчитаны. */
  missing: string[];
}

/** Траты и доходы за [from, to] — то, что человек видит, в нужном охвате. */
export function flow(d: Database.Database, userId: string, from: string, to: string, scope: Scope = 'all'): Flow {
  const base = readMoneySettings(d, userId)!.base_currency;
  const shared = new Map(readAccounts(d, userId).map((a) => [a.id, a.shared]));
  const ops = readOps(d, userId, from, to).filter((o) => {
    if ((o.kind !== 'expense' && o.kind !== 'income') || o.debt_id) return false;
    const s = shared.get(o.account_id) ?? false;
    return scope === 'all' || (scope === 'family' ? s : !s);
  });
  const ids = new Set(ops.filter((o) => o.items_count > 0).map((o) => o.id));
  const items = new Map<string, { category_id: string | null; total_minor: number }[]>();
  if (ids.size) {
    const rows = d
      .prepare('select i.op_id, i.category_id, i.total_minor from money_items i join money_ops o on o.id = i.op_id where o.day between ? and ?')
      .all(from, to) as { op_id: string; category_id: string | null; total_minor: number }[];
    for (const r of rows) {
      if (!ids.has(r.op_id)) continue;
      const list = items.get(r.op_id) ?? [];
      list.push(r);
      items.set(r.op_id, list);
    }
  }
  const b = book(d, userId);
  const out: Flow = { parts: [], income: [], ops: new Map(), missing: [] };
  const missing = new Set<string>();
  for (const o of ops) {
    out.ops.set(o.id, { day: o.day, payee: o.payee, shared: shared.get(o.account_id) ?? false });
    if (o.kind === 'expense') {
      const p = spendParts(o, items.get(o.id) ?? [], b, base);
      if (!p.length) missing.add(o.currency);
      out.parts.push(...p);
    } else {
      const v = b.convert(o.amount_minor, o.currency, base, o.day);
      if (v === null) missing.add(o.currency);
      else out.income.push({ op_id: o.id, category_id: o.category_id, base_minor: v, day: o.day });
    }
  }
  out.missing = [...missing];
  return out;
}

const sum = (list: { base_minor: number }[]) => list.reduce((s, x) => s + x.base_minor, 0);

export function report(d: Database.Database, userId: string, period: Period, anchor: string, scope: Scope) {
  const cur = periodRange(period, anchor);
  const prev = periodRange(period, anchor, -1);
  const bars = [-5, -4, -3, -2, -1, 0].map((n) => periodRange(period, anchor, n));
  const f = flow(d, userId, bars[0].from, cur.to, scope);
  const dayOf = (p: { op_id: string }) => f.ops.get(p.op_id)!.day;
  const inR = (r: { from: string; to: string }) => (p: { op_id: string }) => dayOf(p) >= r.from && dayOf(p) <= r.to;
  const now = f.parts.filter(inR(cur));
  const before = f.parts.filter(inR(prev));
  const names = new Map(readCategories(d, userId).map((c) => [c.id, c.name]));
  // Категория из архива или чужая семейная — имя возьмём из операций.
  const opNames = new Map(readOps(d, userId, bars[0].from, cur.to).map((o) => [o.category_id, o.category_name]));
  const byCat = new Map<string | null, { spend: number; prev: number }>();
  for (const p of now) byCat.set(p.category_id, { spend: (byCat.get(p.category_id)?.spend ?? 0) + p.base_minor, prev: byCat.get(p.category_id)?.prev ?? 0 });
  for (const p of before) byCat.set(p.category_id, { spend: byCat.get(p.category_id)?.spend ?? 0, prev: (byCat.get(p.category_id)?.prev ?? 0) + p.base_minor });
  const payees = new Map<string, { name: string; spend: number; ops: Set<string> }>();
  for (const p of now) {
    const name = f.ops.get(p.op_id)!.payee?.trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const e = payees.get(k) ?? { name, spend: 0, ops: new Set<string>() };
    e.spend += p.base_minor;
    e.ops.add(p.op_id);
    payees.set(k, e);
  }
  return {
    period,
    title: cur.title,
    from: cur.from,
    to: cur.to,
    spend: sum(now),
    income: sum(f.income.filter(inR(cur))),
    prev_spend: sum(before),
    prev_income: sum(f.income.filter(inR(prev))),
    bars: bars.map((r) => ({ from: r.from, to: r.to, short: r.short, spend: sum(f.parts.filter(inR(r))), income: sum(f.income.filter(inR(r))) })),
    categories: [...byCat]
      .map(([id, v]) => ({ id, name: id ? (names.get(id) ?? opNames.get(id) ?? 'Категория') : 'Без категории', spend: v.spend, prev: v.prev }))
      .filter((c) => c.spend > 0 || c.prev > 0)
      .sort((a, b) => b.spend - a.spend || b.prev - a.prev),
    payees: [...payees.values()]
      .map((p) => ({ name: p.name, spend: p.spend, count: p.ops.size }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10),
    missing_rates: f.missing,
  };
}

// ---------------------------------------------------------------- бюджеты и главная

export function readBudgets(d: Database.Database, userId: string): { category_id: string; limit_minor: number }[] {
  return d
    .prepare('select b.category_id, b.limit_minor from money_budgets b join money_categories c on c.id = b.category_id where b.user_id = ? and c.archived = 0')
    .all(userId) as { category_id: string; limit_minor: number }[];
}

/** Бюджет семьи на месяц: сколько всего можно потратить с семейных счетов. */
export function readFamilyBudget(d: Database.Database, userId: string): { limit_minor: number; currency: string } | null {
  const hh = householdOf(d, userId);
  if (!hh) return null;
  return (d.prepare('select limit_minor, currency from money_family_budget where household_id = ?').get(hh) as { limit_minor: number; currency: string } | undefined) ?? null;
}

/** { limit_minor, currency } — задать; limit_minor: null — убрать. Менять может любой в семье. */
export function setFamilyBudget(d: Database.Database, userId: string, body: Record<string, unknown>) {
  const hh = householdOf(d, userId);
  if (!hh) throw new HttpError(400, 'Бюджет семьи — когда есть семья: создайте её в настройках.');
  if (body.limit_minor === null) {
    d.prepare('delete from money_family_budget where household_id = ?').run(hh);
    return { ok: true };
  }
  const n = Number(body.limit_minor);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Бюджет — сумма больше нуля.');
  const cur = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'RUB';
  d.prepare(
    'insert into money_family_budget (household_id, limit_minor, currency) values (?, ?, ?) on conflict (household_id) do update set limit_minor = excluded.limit_minor, currency = excluded.currency',
  ).run(hh, n, cur);
  return { ok: true };
}

export function setBudget(d: Database.Database, userId: string, body: Record<string, unknown>) {
  const cat = d.prepare("select id from money_categories where id = ? and user_id = ? and kind = 'expense'").get(body.category_id ?? '', userId) as { id: string } | undefined;
  if (!cat) throw new HttpError(400, 'Нет такой категории расходов.');
  if (body.limit_minor === null || body.limit_minor === 0) {
    d.prepare('delete from money_budgets where user_id = ? and category_id = ?').run(userId, cat.id);
    return { ok: true };
  }
  const n = Number(body.limit_minor);
  if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, 'Неверная сумма бюджета.');
  d.prepare('insert into money_budgets (user_id, category_id, limit_minor) values (?, ?, ?) on conflict (user_id, category_id) do update set limit_minor = excluded.limit_minor').run(userId, cat.id, n);
  return { ok: true };
}

/**
 * Для главной: траты месяца по частям (чек — по категориям позиций), чтобы
 * экран сам считал «Моё / Семья / Всё» и бюджеты, и итог прошлого месяца.
 */
export function monthFlow(d: Database.Database, userId: string, month: string) {
  const cur = periodRange('month', `${month}-01`);
  const prev = periodRange('month', `${month}-01`, -1);
  const f = flow(d, userId, prev.from, cur.to);
  const parts: Part[] = [];
  const prevSpend = { mine: 0, family: 0 };
  for (const p of f.parts) {
    const o = f.ops.get(p.op_id)!;
    if (o.day >= cur.from) parts.push(p);
    else prevSpend[o.shared ? 'family' : 'mine'] += p.base_minor;
  }
  return { month_parts: parts, prev_spend: prevSpend };
}

// ---------------------------------------------------------------- цены

export function prices(d: Database.Database, userId: string, q: string, key: string | null) {
  const rows = readItemPrices(d, userId);
  if (key) return { history: priceHistory(rows, key) };
  return { items: priceStats(rows, q).slice(0, 200) };
}

// ---------------------------------------------------------------- вопрос ИИ

const MONTHS = 12;
const ITEMS_PER_MONTH = 300;

/** Данные для вопроса — коротко, в основной валюте, без лишних личных подробностей. */
function askContext(d: Database.Database, userId: string, today: string): string {
  const base = readMoneySettings(d, userId)!.base_currency;
  const fmt = (n: number) => `${formatMinor(n, base, { trim: true })} ${base}`;
  const from = periodRange('month', today, -(MONTHS - 1)).from;
  const f = flow(d, userId, from, today);
  const names = new Map(readCategories(d, userId).map((c) => [c.id, c.name]));
  const lines: string[] = [`Основная валюта: ${base}. Сегодня ${today}.`];
  const months = Array.from({ length: MONTHS }, (_, i) => periodRange('month', today, i - (MONTHS - 1)));
  lines.push('Траты и доходы по месяцам (траты по категориям):');
  for (const m of months) {
    const inM = (p: { op_id: string }) => {
      const day = f.ops.get(p.op_id)!.day;
      return day >= m.from && day <= m.to;
    };
    const parts = f.parts.filter(inM);
    if (!parts.length && !f.income.some(inM)) continue;
    const byCat = new Map<string, number>();
    for (const p of parts) {
      const n = p.category_id ? (names.get(p.category_id) ?? 'Другая') : 'Без категории';
      byCat.set(n, (byCat.get(n) ?? 0) + p.base_minor);
    }
    lines.push(
      `${m.title}: траты ${fmt(sum(parts))}, доходы ${fmt(sum(f.income.filter(inM)))}; ` +
        [...byCat]
          .sort((a, b) => b[1] - a[1])
          .map(([n, v]) => `${n} ${fmt(v)}`)
          .join(', '),
    );
  }
  // Позиции чеков за этот и прошлый месяц — для вопросов о товарах
  // («сколько ушло на энергетики»): по категориям этого не видно.
  const b = book(d, userId);
  for (const m of [periodRange('month', today, -1), periodRange('month', today, 0)]) {
    const byName = new Map<string, { sum: number; n: number }>();
    for (const o of readOps(d, userId, m.from, m.to)) {
      if (o.kind !== 'expense' || o.debt_id || !o.items?.length) continue;
      for (const i of o.items) {
        const v = b.convert(i.total_minor, o.orig_currency ?? o.currency, base, o.day);
        if (v === null) continue;
        const e = byName.get(i.name) ?? { sum: 0, n: 0 };
        e.sum += v;
        e.n++;
        byName.set(i.name, e);
      }
    }
    if (!byName.size) continue;
    const list = [...byName].sort((x, y) => y[1].sum - x[1].sum).slice(0, ITEMS_PER_MONTH);
    lines.push(`Позиции чеков, ${m.title} (как в чеке — сумма, сколько раз): ${list.map(([n, v]) => `${n} — ${fmt(v.sum)}${v.n > 1 ? ` (${v.n} раза)` : ''}`).join('; ')}.`);
  }
  const payees = new Map<string, { spend: number; n: number }>();
  for (const p of f.parts) {
    const name = f.ops.get(p.op_id)!.payee?.trim();
    if (!name) continue;
    const e = payees.get(name) ?? { spend: 0, n: 0 };
    e.spend += p.base_minor;
    e.n++;
    payees.set(name, e);
  }
  const top = [...payees].sort((a, b) => b[1].spend - a[1].spend).slice(0, 25);
  if (top.length) lines.push(`Где больше всего тратили за год: ${top.map(([n, v]) => `${n} ${fmt(v.spend)} (${v.n} раз)`).join('; ')}.`);
  const budgets = readBudgets(d, userId);
  if (budgets.length) lines.push(`Бюджеты на месяц: ${budgets.map((b) => `${names.get(b.category_id)} ${fmt(b.limit_minor)}`).join(', ')}.`);
  const accounts = readAccounts(d, userId).filter((a) => !a.archived);
  lines.push(`Счета сейчас: ${accounts.map((a) => `${a.name} ${formatMinor(a.balance_minor, a.currency, { trim: true })} ${a.currency}`).join(', ')}.`);
  const pr = priceStats(readItemPrices(d, userId))
    .filter((p) => p.change !== null)
    .slice(0, 15);
  if (pr.length) {
    lines.push(
      `Цены из чеков (первая → последняя покупка): ${pr
        .map((p) => `${p.name}${p.unit ? ` за ${p.unit}` : ''} ${formatMinor(p.first.price, p.currency, { trim: true })} → ${formatMinor(p.last.price, p.currency, { trim: true })} ${p.currency} (${p.change! > 0 ? '+' : ''}${p.change}%)`)
        .join('; ')}.`,
    );
  }
  if (f.missing.length) lines.push(`Нет курса для: ${f.missing.join(', ')} — эти операции не посчитаны.`);
  return lines.join('\n');
}

export async function ask(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<{ answer: string }> {
  const question = text(body.question, 500, 'Вопрос') as string;
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const raw = (await askJson(d, userId, {
    system:
      'Ты помощник в приложении учёта личных финансов. Отвечай на вопрос человека по его данным ниже — по-русски, коротко (2–5 предложений), ' +
      'с конкретными суммами и месяцами. Суммы пиши с пробелами между тысячами. Считай аккуратно, складывай только то, что есть в данных. ' +
      'Про конкретные товары («энергетики», «кофе», «сигареты») считай по позициям чеков: узнавай товар по названию и марке ' +
      '(Adrenaline, Red Bull, Burn — энергетики), перечисли, что сложил. Траты без чека товаров не показывают — скажи об этом. ' +
      'Если данных не хватает — так и скажи и подскажи, что записать. Не давай советов по инвестициям и ценным бумагам. ' +
      `Ответ строго JSON: {"answer":"…"}\n\nДанные:\n${askContext(d, userId, today)}`,
    user: question,
    maxTokens: 1200,
  })) as { answer?: unknown };
  const answer = typeof raw?.answer === 'string' ? raw.answer.trim().slice(0, 2000) : '';
  if (!answer) throw new HttpError(502, 'ИИ ответил непонятно. Спросите иначе.');
  return { answer };
}

