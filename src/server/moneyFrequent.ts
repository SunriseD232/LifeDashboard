import type Database from 'better-sqlite3';
import { normPayee } from '@/lib/moneyMerchants';
import type { MoneyFrequent } from '@/lib/money';

const DAYS = 60;
const MIN_TIMES = 3;
const MAX = 4;

/**
 * Частые траты для записи одним нажатием: то же место, та же сумма и тот же
 * счёт — хотя бы 3 раза за 60 дней («Кофе 350», «Метро 62»). Сначала самые
 * частые, при равенстве — недавние.
 */
export function readFrequent(d: Database.Database, userId: string, today: string): MoneyFrequent[] {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - DAYS * 864e5).toISOString().slice(0, 10);
  const rows = d
    .prepare(
      `select o.payee, o.amount_minor, o.currency, o.account_id, o.category_id, o.day
       from money_ops o join money_accounts a on a.id = o.account_id and a.archived = 0
       where o.user_id = ? and o.kind = 'expense' and o.debt_id is null and o.payee is not null and o.day between ? and ?
       order by o.day desc, o.created_at desc`,
    )
    .all(userId, since, today) as { payee: string; amount_minor: number; currency: string; account_id: string; category_id: string | null; day: string }[];
  const groups = new Map<string, MoneyFrequent & { last: string }>();
  for (const r of rows) {
    const k = `${normPayee(r.payee)}|${r.amount_minor}|${r.account_id}`;
    const g = groups.get(k);
    if (g) g.count++;
    else groups.set(k, { payee: r.payee.trim(), amount_minor: r.amount_minor, currency: r.currency, account_id: r.account_id, category_id: r.category_id, count: 1, last: r.day });
  }
  return [...groups.values()]
    .filter((g) => g.count >= MIN_TIMES)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, MAX)
    .map(({ last: _last, ...g }) => g);
}
