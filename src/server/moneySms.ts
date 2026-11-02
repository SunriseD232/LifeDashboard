import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { convert } from '@/lib/money';
import { parseBankSms, type SmsOp } from '@/lib/moneySms';
import { userLogin } from '@/lib/auth';
import { HttpError, text } from './http';
import { insertOp, opFields } from './moneyOps';
import { moscowDay, todayRates } from './moneyRates';
import { moneyAllowed, readAccounts, readMoneySettings, readUserRates, visibleAccount } from './moneyStore';

/**
 * SMS и push банков → операции через «Команды» iOS. Автоматизация «Когда
 * приходит сообщение от банка» отправляет его текст POST-запросом на
 * /task/api/money-sms с ключом в заголовке Authorization — без входа и кук.
 * Ключ показывается один раз, в базе — только его хэш.
 */

type DB = Database.Database;

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const DAILY = 300;

export function smsStatus(d: DB, userId: string) {
  const row = d.prepare('select account_id, created_at, last_used from money_sms_tokens where user_id = ?').get(userId) as
    | { account_id: string | null; created_at: string; last_used: string | null }
    | undefined;
  return { on: !!row, account_id: row?.account_id ?? null, created_at: row?.created_at ?? null, last_used: row?.last_used ?? null };
}

/** Новый ключ (старый перестаёт работать). Возвращается один раз. */
export function smsCreate(d: DB, userId: string, accountId: unknown) {
  const acc = accountId ? visibleAccount(d, userId, accountId) : null;
  if (accountId && !acc) throw new HttpError(400, 'Нет такого счёта.');
  const token = `ms_${randomBytes(24).toString('base64url')}`;
  d.prepare(
    `insert into money_sms_tokens (user_id, token_hash, account_id) values (?, ?, ?)
     on conflict (user_id) do update set token_hash = excluded.token_hash, account_id = excluded.account_id, created_at = datetime('now'), last_used = null`,
  ).run(userId, hash(token), acc?.id ?? null);
  return { token };
}

export function smsSetAccount(d: DB, userId: string, accountId: unknown) {
  const acc = accountId ? visibleAccount(d, userId, accountId) : null;
  if (accountId && !acc) throw new HttpError(400, 'Нет такого счёта.');
  d.prepare('update money_sms_tokens set account_id = ? where user_id = ?').run(acc?.id ?? null, userId);
  return { ok: true };
}

export function smsDelete(d: DB, userId: string) {
  d.prepare('delete from money_sms_tokens where user_id = ?').run(userId);
  return { ok: true };
}

interface Plan {
  sms: SmsOp;
  account: { id: string; name: string; currency: string };
  amount_minor: number;
  orig: { amount_minor: number; currency: string } | null;
  category_id: string | null;
}

/** Что запишем: счёт по последним цифрам карты, иначе выбранный для SMS, иначе первый свой. */
function plan(d: DB, userId: string, raw: string, defaultAccount: string | null): Plan | null {
  const sms = parseBankSms(raw);
  if (!sms) return null;
  const accounts = readAccounts(d, userId).filter((a) => !a.archived);
  const account =
    (sms.card_last4 ? accounts.find((a) => a.card_last4 === sms.card_last4) : undefined) ??
    accounts.find((a) => a.id === defaultAccount) ??
    accounts.find((a) => a.mine && a.currency === sms.currency) ??
    accounts.find((a) => a.mine);
  if (!account) return null;
  const smsMinor = Math.round(sms.amount * 100);
  let amount = smsMinor;
  let orig: Plan['orig'] = null;
  if (sms.currency !== account.currency) {
    const { rates } = todayRates(d);
    const own = readUserRates(d, userId);
    const conv = convert(smsMinor, sms.currency, account.currency, (c) => (c === 'RUB' ? 1 : (rates[c] ?? own[c])));
    if (!conv) return null;
    amount = conv;
    orig = { amount_minor: smsMinor, currency: sms.currency };
  }
  // Категория — как у прошлой операции с тем же местом.
  const past = sms.payee
    ? (d
        .prepare(
          `select o.category_id from money_ops o join money_categories c on c.id = o.category_id and c.archived = 0
           where o.user_id = ? and lower(o.payee) = lower(?) and o.kind = ? order by o.day desc limit 1`,
        )
        .get(userId, sms.payee, sms.kind) as { category_id: string } | undefined)
    : undefined;
  return { sms, account: { id: account.id, name: account.name, currency: account.currency }, amount_minor: amount, orig, category_id: past?.category_id ?? null };
}

/** Проверка из настроек: что получится из этого текста (ничего не записывает). */
export function smsPreview(d: DB, userId: string, body: Record<string, unknown>) {
  const raw = text(body.text, 1000, 'Текст SMS') as string;
  const p = plan(d, userId, raw, smsStatus(d, userId).account_id);
  if (!p) return { op: null };
  return { op: { kind: p.sms.kind, amount_minor: p.amount_minor, currency: p.account.currency, orig: p.orig, payee: p.sms.payee, account: p.account.name, card_last4: p.sms.card_last4, category_id: p.category_id } };
}

/**
 * Тело входящего запроса — как сумели прислать: JSON { text }, он же со
 * «сырыми» переносами строк внутри (MacroDroid и Tasker подставляют текст
 * сообщения в JSON как есть), форма text=… или просто текст сообщения.
 */
export function readSmsBody(raw: string): Record<string, unknown> {
  const s = raw.slice(0, 5000);
  for (const t of [s, s.replace(/[\u0000-\u001f]+/g, ' ')]) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === 'object') return v as Record<string, unknown>;
    } catch {
      /* не JSON — дальше */
    }
  }
  if (/^\s*(text|message|token)=/.test(s)) return Object.fromEntries(new URLSearchParams(s));
  return { text: s };
}

/** Входящее SMS или уведомление банка («Команды» iOS, MacroDroid на Android). Без входа: кто — по ключу. */
export function smsIncoming(d: DB, authHeader: string | null, body: Record<string, unknown>) {
  const token = (authHeader?.replace(/^Bearer\s+/i, '') || (typeof body.token === 'string' ? body.token : '')).trim();
  if (!token.startsWith('ms_')) throw new HttpError(401, 'Нет ключа. Создайте его в «Деньгах»: Ещё → SMS от банка.');
  const row = d.prepare('select user_id, account_id, used_today, used_day from money_sms_tokens where token_hash = ?').get(hash(token)) as
    | { user_id: string; account_id: string | null; used_today: number; used_day: string | null }
    | undefined;
  if (!row) throw new HttpError(401, 'Ключ не подходит — создайте новый в «Деньгах».');
  const userId = row.user_id;
  if (!moneyAllowed(userId, userLogin(userId)) || !readMoneySettings(d, userId)) throw new HttpError(403, '«Деньги» недоступны.');
  const today = moscowDay();
  const used = row.used_day === today ? row.used_today : 0;
  if (used >= DAILY) throw new HttpError(429, 'Слишком много сообщений за сутки.');
  d.prepare("update money_sms_tokens set used_today = ?, used_day = ?, last_used = datetime('now') where user_id = ?").run(used + 1, today, userId);

  // «Команды» присылают текст как есть; бывает — объектом сообщения.
  const raw = typeof body.text === 'string' ? body.text : typeof body.message === 'string' ? body.message : '';
  if (!raw.trim()) throw new HttpError(400, 'Пустое сообщение. В «Команде» в поле text должен быть «Ввод быстрой команды».');
  const p = plan(d, userId, raw.slice(0, 1000), row.account_id);
  if (!p) return { ok: true, skipped: 'не похоже на операцию' };
  // То же сообщение второй раз (автоматизация сработала дважды) — не задваиваем.
  const key = `sms:${hash(raw.replace(/\s+/g, ' ').trim()).slice(0, 32)}`;
  if (d.prepare('select 1 from money_ops where account_id = ? and import_key = ?').get(p.account.id, key)) return { ok: true, skipped: 'уже записано' };
  // Деньги за трату вернулись — это не доход: убираем и трату.
  if (p.sms.kind === 'income') {
    const spent = refundedSpend(d, userId, { account_id: p.account.id, amount_minor: p.amount_minor, payee: p.sms.payee, day: today, refund: p.sms.refund });
    if (spent) {
      d.prepare('delete from money_ops where id = ?').run(spent);
      return { ok: true, skipped: 'возврат — трата отменена' };
    }
  }
  const f = opFields(d, userId, {
    kind: p.sms.kind,
    day: today,
    account_id: p.account.id,
    amount_minor: p.amount_minor,
    category_id: p.category_id,
    payee: p.sms.payee || null,
    orig_amount_minor: p.orig?.amount_minor,
    orig_currency: p.orig?.currency,
  });
  const id = insertOp(d, userId, f, { source: 'sms', import_key: key });
  return { ok: true, id, account: p.account.name };
}

const DAY_MS = 864e5;
const REFUND_DAYS = 7;

/**
 * Трата из SMS, которую отменило это поступление: тот же счёт и сумма, не
 * раньше недели назад, без чека, — и это возврат по тексту, или то же место,
 * или списание-проверка карты на 1 ₽ (1 $, 1 €). Нет — null.
 */
function refundedSpend(d: DB, userId: string, inc: { account_id: string; amount_minor: number; payee: string; day: string; refund: boolean; not?: string }): string | null {
  const since = new Date(Date.parse(`${inc.day}T12:00:00Z`) - REFUND_DAYS * DAY_MS).toISOString().slice(0, 10);
  const list = d
    .prepare(
      `select o.id, o.payee from money_ops o
       where o.user_id = ? and o.account_id = ? and o.kind = 'expense' and o.source = 'sms' and o.amount_minor = ? and o.day between ? and ?
         and o.debt_id is null and o.id is not ? and not exists (select 1 from money_items i where i.op_id = o.id)
       order by o.day desc, o.created_at desc`,
    )
    .all(userId, inc.account_id, inc.amount_minor, since, inc.day, inc.not ?? null) as { id: string; payee: string | null }[];
  const same = (a: string | null) => !!a && !!inc.payee && a.toLowerCase() === inc.payee.toLowerCase();
  return (list.find((o) => same(o.payee)) ?? (inc.refund || inc.amount_minor <= 100 ? list[0] : undefined))?.id ?? null;
}

/**
 * Пары «списали — вернули» из SMS, записанные раньше (до того, как мы
 * научились их узнавать): обе операции убираем. Запускается при загрузке.
 */
export function dropSmsRefunds(d: DB, userId: string, today: string): number {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 31 * DAY_MS).toISOString().slice(0, 10);
  const incomes = d
    .prepare(
      `select o.id, o.account_id, o.amount_minor, o.payee, o.day from money_ops o
       where o.user_id = ? and o.kind = 'income' and o.source = 'sms' and o.day >= ? and o.debt_id is null`,
    )
    .all(userId, since) as { id: string; account_id: string; amount_minor: number; payee: string | null; day: string }[];
  let n = 0;
  for (const inc of incomes) {
    // Текст SMS не храним: возврат узнаём по тому же месту или по 1 ₽.
    const spent = refundedSpend(d, userId, { ...inc, payee: inc.payee ?? '', refund: false, not: inc.id });
    if (!spent) continue;
    d.prepare('delete from money_ops where id in (?, ?)').run(spent, inc.id);
    n++;
  }
  return n;
}
