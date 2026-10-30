import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { detectRecurring, dueDates, nextDate, type MoneyDebt, type MoneyGoal, type MoneyRecurring, type RecurUnit } from '@/lib/moneyPlans';
import { DAY_RE, HttpError, text } from './http';
import { currencyCode, insertOp, minor, opFields, ownCategory } from './moneyOps';
import { readOps, visibleAccount } from './moneyStore';

/**
 * Регулярные платежи, долги и цели «Денег». Всё — личное (свои строки),
 * а деньги ходят по счетам обычными операциями.
 */

type DB = Database.Database;

const day = (v: unknown, field = 'Дата'): string => {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, `Неверная дата: «${field}».`);
  return v;
};

// ---------------------------------------------------------------- регулярные

interface RecurRow {
  id: string;
  account_id: string;
  kind: 'expense' | 'income';
  amount_minor: number;
  currency: string;
  category_id: string | null;
  payee: string;
  note: string | null;
  unit: RecurUnit;
  every: number;
  anchor_day: number;
  next_day: string;
  mode: 'auto' | 'ask';
  active: number;
}

function recurRows(d: DB, userId: string): RecurRow[] {
  return d
    .prepare(
      `select r.*, a.currency from money_recurring r join money_accounts a on a.id = r.account_id
       where r.user_id = ? order by r.active desc, r.next_day, r.payee`,
    )
    .all(userId) as RecurRow[];
}

export function readRecurring(d: DB, userId: string): MoneyRecurring[] {
  return recurRows(d, userId).map(({ anchor_day: _a, active, ...r }) => ({ ...r, active: !!active }));
}

/** Запись по шаблону платежа на день — как будто человек ввёл её сам. */
function recordRecur(d: DB, userId: string, r: RecurRow, onDay: string) {
  const f = opFields(d, userId, { kind: r.kind, day: onDay, account_id: r.account_id, amount_minor: r.amount_minor, category_id: r.category_id, payee: r.payee, note: r.note }, r.category_id);
  return insertOp(d, userId, f, { source: 'recurring' });
}

/**
 * Наступившие платежи с «записывать сам» — записать (пропущенные тоже,
 * не больше 24), дату сдвинуть. С «спросить» — ждут человека на главной.
 * Зовётся при каждой загрузке: без отдельного расписания на сервере.
 */
export function processRecurring(d: DB, userId: string, today: string): number {
  let made = 0;
  const due = recurRows(d, userId).filter((r) => r.active && r.mode === 'auto' && r.next_day <= today);
  for (const r of due) {
    d.transaction(() => {
      const { due: days, next } = dueDates(r.next_day, today, r.unit, r.every, r.anchor_day);
      // Счёт или категорию могли удалить — тогда платёж выключаем, а не падаем.
      try {
        for (const x of days) {
          recordRecur(d, userId, r, x);
          made++;
        }
        d.prepare('update money_recurring set next_day = ? where id = ?').run(next, r.id);
      } catch {
        d.prepare('update money_recurring set active = 0 where id = ?').run(r.id);
      }
    })();
  }
  return made;
}

function recurFields(d: DB, userId: string, b: Record<string, unknown>) {
  const acc = visibleAccount(d, userId, b.account_id);
  if (!acc) throw new HttpError(400, 'Выберите счёт.');
  const kind = b.kind === 'income' ? 'income' : 'expense';
  const unit: RecurUnit = b.unit === 'week' || b.unit === 'year' ? b.unit : 'month';
  const every = Math.min(52, Math.max(1, Math.floor(Number(b.every) || 1)));
  const next = day(b.next_day, 'Следующий платёж');
  return {
    account_id: acc.id,
    kind,
    amount_minor: minor(b.amount_minor, 'Сумма'),
    category_id: ownCategory(d, userId, b.category_id, kind),
    payee: text(b.payee, 120, 'Название') as string,
    note: text(b.note, 300, 'Заметка', true),
    unit,
    every,
    next_day: next,
    anchor_day: Number(next.slice(8, 10)),
    mode: b.mode === 'auto' ? 'auto' : 'ask',
  };
}

export function recurring(d: DB, userId: string, method: string, id: string | undefined, action: string | undefined, b: Record<string, unknown>, today: string): unknown {
  if (method === 'GET' && id === 'suggest') {
    const from = new Date(Date.parse(`${today}T12:00:00Z`) - 200 * 864e5).toISOString().slice(0, 10);
    const ops = readOps(d, userId, from, today).filter((o) => o.mine && !o.debt_id);
    // Давно не было (больше двух периодов) — подписку, видимо, отменили.
    const stale = (c: { unit: RecurUnit; last_day: string }) => Date.parse(`${today}T12:00:00Z`) - Date.parse(`${c.last_day}T12:00:00Z`) > (c.unit === 'week' ? 15 : 70) * 864e5;
    const suggestions = detectRecurring(ops, recurRows(d, userId).map((r) => r.payee))
      .filter((c) => !stale(c))
      .map((c) => {
        let next = c.next_day;
        while (next < today) next = nextDate(next, c.unit, 1, Number(c.last_day.slice(8, 10)));
        return { ...c, next_day: next };
      });
    return { suggestions };
  }
  if (method === 'POST' && !id) {
    const f = recurFields(d, userId, b);
    const rid = randomUUID();
    d.prepare(
      `insert into money_recurring (id, user_id, account_id, kind, amount_minor, category_id, payee, note, unit, every, anchor_day, next_day, mode)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(rid, userId, f.account_id, f.kind, f.amount_minor, f.category_id, f.payee, f.note, f.unit, f.every, f.anchor_day, f.next_day, f.mode);
    return { id: rid };
  }
  const r = recurRows(d, userId).find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'Платёж не найден.');
  if (method === 'PATCH' && !action) {
    if (b.active !== undefined && Object.keys(b).length === 1) {
      d.prepare('update money_recurring set active = ? where id = ?').run(b.active ? 1 : 0, r.id);
      return { ok: true };
    }
    const f = recurFields(d, userId, b);
    d.prepare(
      `update money_recurring set account_id = ?, kind = ?, amount_minor = ?, category_id = ?, payee = ?, note = ?, unit = ?, every = ?,
         anchor_day = ?, next_day = ?, mode = ?, active = 1 where id = ?`,
    ).run(f.account_id, f.kind, f.amount_minor, f.category_id, f.payee, f.note, f.unit, f.every, f.anchor_day, f.next_day, f.mode, r.id);
    return { ok: true };
  }
  if (method === 'DELETE') {
    d.prepare('delete from money_recurring where id = ?').run(r.id);
    return { ok: true };
  }
  // «Записать» и «Пропустить» для платежа, который спрашивает.
  if (method === 'POST' && (action === 'pay' || action === 'skip')) {
    let opId: string | null = null;
    d.transaction(() => {
      if (action === 'pay') {
        const amount = b.amount_minor !== undefined ? minor(b.amount_minor, 'Сумма') : r.amount_minor;
        opId = recordRecur(d, userId, { ...r, amount_minor: amount }, r.next_day <= today ? r.next_day : today);
      }
      d.prepare('update money_recurring set next_day = ? where id = ?').run(nextDate(r.next_day, r.unit, r.every, r.anchor_day), r.id);
    })();
    return { ok: true, op_id: opId };
  }
  return undefined;
}

// ---------------------------------------------------------------- долги

export function readDebts(d: DB, userId: string): MoneyDebt[] {
  const rows = d.prepare('select * from money_debts where user_id = ? order by closed, coalesce(due_day, day)').all(userId) as (Omit<MoneyDebt, 'paid_minor' | 'closed'> & { closed: number })[];
  // Возвраты — операции с debt_id «в обратную сторону»: дал в долг — пришло, взял — ушло.
  const paid = d.prepare(
    `select coalesce(sum(case when o.orig_currency = ? then o.orig_amount_minor else o.amount_minor end), 0) as n
     from money_ops o where o.debt_id = ? and o.kind = ?`,
  );
  return rows.map((r) => ({
    ...r,
    closed: !!r.closed,
    paid_minor: (paid.get(r.currency, r.id, r.direction === 'lent' ? 'income' : 'expense') as { n: number }).n,
  }));
}

export function debts(d: DB, userId: string, method: string, id: string | undefined, action: string | undefined, b: Record<string, unknown>): unknown {
  if (method === 'POST' && !id) {
    const direction = b.direction === 'borrowed' ? 'borrowed' : 'lent';
    const person = text(b.person, 80, 'Кто') as string;
    const amount = minor(b.amount_minor, 'Сумма');
    const onDay = day(b.day);
    const due = b.due_day ? day(b.due_day, 'Вернуть до') : null;
    const acc = b.account_id ? visibleAccount(d, userId, b.account_id) : null;
    if (b.account_id && !acc) throw new HttpError(400, 'Нет такого счёта.');
    const cur = acc ? acc.currency : currencyCode(b.currency);
    const did = randomUUID();
    d.transaction(() => {
      d.prepare('insert into money_debts (id, user_id, person, direction, amount_minor, currency, day, due_day, note) values (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        did,
        userId,
        person,
        direction,
        amount,
        cur,
        onDay,
        due,
        text(b.note, 300, 'Заметка', true),
      );
      if (acc) {
        const f = opFields(d, userId, { kind: direction === 'lent' ? 'expense' : 'income', day: onDay, account_id: acc.id, amount_minor: amount, payee: person, note: direction === 'lent' ? 'Дал в долг' : 'Взял в долг' });
        insertOp(d, userId, f, { source: 'debt', debt_id: did });
      }
    })();
    return { id: did };
  }
  const debt = readDebts(d, userId).find((x) => x.id === id);
  if (!debt) throw new HttpError(404, 'Долг не найден.');
  if (method === 'POST' && action === 'pay') {
    // Возврат: сумма — в валюте долга; счёт в другой валюте — сколько пришло на счёт.
    const amount = minor(b.amount_minor, 'Сумма');
    const onDay = day(b.day);
    const acc = visibleAccount(d, userId, b.account_id);
    if (!acc) throw new HttpError(400, 'Выберите счёт, через который вернули.');
    const kind = debt.direction === 'lent' ? 'income' : 'expense';
    d.transaction(() => {
      const f = opFields(d, userId, {
        kind,
        day: onDay,
        account_id: acc.id,
        amount_minor: acc.currency === debt.currency ? amount : b.account_amount_minor,
        payee: debt.person,
        note: debt.direction === 'lent' ? 'Вернули долг' : 'Вернул долг',
        orig_amount_minor: acc.currency === debt.currency ? undefined : amount,
        orig_currency: acc.currency === debt.currency ? undefined : debt.currency,
      });
      insertOp(d, userId, f, { source: 'debt', debt_id: debt.id });
      if (debt.paid_minor + amount >= debt.amount_minor) d.prepare('update money_debts set closed = 1 where id = ?').run(debt.id);
    })();
    return { ok: true };
  }
  if (method === 'PATCH') {
    if (b.closed !== undefined) d.prepare('update money_debts set closed = ? where id = ?').run(b.closed ? 1 : 0, debt.id);
    if (b.due_day !== undefined) d.prepare('update money_debts set due_day = ? where id = ?').run(b.due_day ? day(b.due_day, 'Вернуть до') : null, debt.id);
    if (b.person !== undefined) d.prepare('update money_debts set person = ? where id = ?').run(text(b.person, 80, 'Кто'), debt.id);
    if (b.note !== undefined) d.prepare('update money_debts set note = ? where id = ?').run(text(b.note, 300, 'Заметка', true), debt.id);
    return { ok: true };
  }
  if (method === 'DELETE') {
    // Операции по счёту остаются (деньги правда двигались), но уже без долга — и попадут в отчёты.
    d.prepare('delete from money_debts where id = ?').run(debt.id);
    return { ok: true };
  }
  return undefined;
}

// ---------------------------------------------------------------- цели

export function readGoals(d: DB, userId: string): MoneyGoal[] {
  return d
    .prepare('select id, name, target_minor, currency, account_id, saved_minor, due_day from money_goals where user_id = ? and archived = 0 order by created_at')
    .all(userId) as MoneyGoal[];
}

export function goals(d: DB, userId: string, method: string, id: string | undefined, b: Record<string, unknown>): unknown {
  const fields = () => {
    const acc = b.account_id ? visibleAccount(d, userId, b.account_id) : null;
    if (b.account_id && !acc) throw new HttpError(400, 'Нет такого счёта.');
    return {
      name: text(b.name, 80, 'Название') as string,
      target: minor(b.target_minor, 'Сколько нужно'),
      currency: acc ? acc.currency : currencyCode(b.currency),
      account_id: acc?.id ?? null,
      due: b.due_day ? day(b.due_day, 'К какому сроку') : null,
    };
  };
  if (method === 'POST' && !id) {
    const f = fields();
    const gid = randomUUID();
    d.prepare('insert into money_goals (id, user_id, name, target_minor, currency, account_id, saved_minor, due_day) values (?, ?, ?, ?, ?, ?, ?, ?)').run(
      gid,
      userId,
      f.name,
      f.target,
      f.currency,
      f.account_id,
      minor(b.saved_minor ?? 0, 'Уже есть', true),
      f.due,
    );
    return { id: gid };
  }
  const g = d.prepare('select id from money_goals where id = ? and user_id = ?').get(id ?? '', userId) as { id: string } | undefined;
  if (!g) throw new HttpError(404, 'Цель не найдена.');
  if (method === 'PATCH') {
    if (b.add_minor !== undefined) {
      // «Отложил ещё» — для цели без счёта; минус — взял обратно.
      const n = Number(b.add_minor);
      if (!Number.isSafeInteger(n)) throw new HttpError(400, 'Неверная сумма.');
      d.prepare('update money_goals set saved_minor = max(0, saved_minor + ?) where id = ?').run(n, g.id);
      return { ok: true };
    }
    if (b.archived !== undefined) {
      d.prepare('update money_goals set archived = ? where id = ?').run(b.archived ? 1 : 0, g.id);
      return { ok: true };
    }
    const f = fields();
    d.prepare('update money_goals set name = ?, target_minor = ?, currency = ?, account_id = ?, due_day = ? where id = ?').run(f.name, f.target, f.currency, f.account_id, f.due, g.id);
    return { ok: true };
  }
  if (method === 'DELETE') {
    d.prepare('delete from money_goals where id = ?').run(g.id);
    return { ok: true };
  }
  return undefined;
}
