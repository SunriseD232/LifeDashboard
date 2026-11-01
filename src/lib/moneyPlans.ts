/**
 * «Деньги»: регулярные платежи, долги, цели — типы и расчёты без базы.
 */

export type RecurUnit = 'week' | 'month' | 'year';

export interface MoneyRecurring {
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
  next_day: string;
  mode: 'auto' | 'ask';
  active: boolean;
  /** По семейному счёту — видят и записывают все в семье. */
  shared: boolean;
  /** Кто завёл — если не я. */
  author: string | null;
}

export interface MoneyDebt {
  id: string;
  person: string;
  direction: 'lent' | 'borrowed';
  amount_minor: number;
  currency: string;
  /** Сколько уже вернули (в валюте долга). */
  paid_minor: number;
  day: string;
  due_day: string | null;
  note: string | null;
  closed: boolean;
}

export interface MoneyGoal {
  id: string;
  name: string;
  target_minor: number;
  currency: string;
  account_id: string | null;
  saved_minor: number;
  due_day: string | null;
  /** Цель семьи — откладывают все. */
  shared: boolean;
  /** Кто завёл — если не я. */
  author: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Следующая дата после day. Месяцы держатся за исходное число: платёж 31-го
 * в феврале — 28-го (29-го), в марте — снова 31-го.
 */
export function nextDate(day: string, unit: RecurUnit, every: number, anchorDay: number): string {
  const d = utc(day);
  if (unit === 'week') return iso(new Date(d.getTime() + every * 7 * 864e5));
  const months = unit === 'year' ? every * 12 : every;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(anchorDay, last))));
}

/** Все даты платежа, что уже наступили (≤ today), начиная с next; не больше max. */
export function dueDates(next: string, today: string, unit: RecurUnit, every: number, anchorDay: number, max = 24): { due: string[]; next: string } {
  const due: string[] = [];
  let cur = next;
  while (cur <= today && due.length < max) {
    due.push(cur);
    cur = nextDate(cur, unit, every, anchorDay);
  }
  return { due, next: cur };
}

export interface RecurCandidate {
  payee: string;
  kind: 'expense' | 'income';
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  currency: string;
  unit: RecurUnit;
  last_day: string;
  next_day: string;
  count: number;
}

/**
 * Похожее на подписку в истории: одно и то же место, 3+ раза, примерно раз
 * в месяц (25–35 дней) или раз в неделю, сумма гуляет не больше чем на 15%.
 */
export function detectRecurring(
  ops: { kind: string; day: string; payee: string | null; account_id: string; category_id: string | null; amount_minor: number; currency: string }[],
  known: string[],
): RecurCandidate[] {
  const skip = new Set(known.map((k) => k.toLowerCase().trim()));
  const groups = new Map<string, typeof ops>();
  for (const o of ops) {
    if ((o.kind !== 'expense' && o.kind !== 'income') || !o.payee?.trim()) continue;
    const k = `${o.kind}|${o.payee.toLowerCase().trim()}|${o.currency}`;
    if (skip.has(o.payee.toLowerCase().trim())) continue;
    const list = groups.get(k) ?? [];
    list.push(o);
    groups.set(k, list);
  }
  const out: RecurCandidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => (a.day < b.day ? -1 : 1));
    const gaps = list.slice(1).map((o, i) => (utc(o.day).getTime() - utc(list[i].day).getTime()) / 864e5);
    const monthly = gaps.every((g) => g >= 25 && g <= 35);
    const weekly = gaps.every((g) => g >= 6 && g <= 8);
    if (!monthly && !weekly) continue;
    const amounts = list.map((o) => o.amount_minor);
    const avg = amounts.reduce((s, x) => s + x, 0) / amounts.length;
    if (amounts.some((a) => Math.abs(a - avg) > avg * 0.15)) continue;
    const last = list[list.length - 1];
    const unit: RecurUnit = monthly ? 'month' : 'week';
    out.push({
      payee: last.payee!.trim(),
      kind: last.kind as 'expense' | 'income',
      account_id: last.account_id,
      category_id: last.category_id,
      amount_minor: last.amount_minor,
      currency: last.currency,
      unit,
      last_day: last.day,
      next_day: nextDate(last.day, unit, 1, utc(last.day).getUTCDate()),
      count: list.length,
    });
  }
  return out.sort((a, b) => (a.next_day < b.next_day ? -1 : 1));
}

/** Сколько откладывать в месяц, чтобы успеть к сроку; срока нет или прошёл — null. */
export function monthlyNeed(left: number, today: string, due: string | null): number | null {
  if (!due || left <= 0 || due <= today) return null;
  const a = utc(today);
  const b = utc(due);
  const months = Math.max(1, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth());
  return Math.ceil(left / months);
}
