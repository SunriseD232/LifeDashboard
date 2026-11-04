import type Database from 'better-sqlite3';
import { formatMinor } from '@/lib/currencies';
import { minutesOf, plural } from '@/lib/dates';
import { flow, monthFlow, readBudgets } from './moneyReport';
import { moneyAllowed, readCategories, readMoneySettings } from './moneyStore';
import { userLogin } from '@/lib/auth';

/**
 * Push «Денег»: бюджет категории почти кончился (80%) и кончился (100%) —
 * один раз за месяц на порог; вечерний итог трат за день — в выбранное время.
 * Рассылка (src/lib/push.ts) зовёт moneyPushes раз в тик для каждого, у кого
 * есть устройства; отметки об отправке — в money_push_sent.
 */

export interface MoneyPush {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const WINDOW_MIN = 10;
const LEVELS = [100, 80] as const;

/** Отметить отправку; false — уже отправляли. */
function mark(d: Database.Database, userId: string, key: string): boolean {
  return d.prepare('insert or ignore into money_push_sent (user_id, key) values (?, ?)').run(userId, key).changes > 0;
}

const money = (minor: number, cur: string) => `${formatMinor(minor, cur, { whole: true })} ${cur === 'RUB' ? '₽' : cur}`;

/** Пороги бюджетов, которые пересекли и о которых ещё не сказали. */
export function budgetPushes(d: Database.Database, userId: string, day: string): MoneyPush[] {
  const s = readMoneySettings(d, userId);
  if (!s?.budget_push) return [];
  const budgets = readBudgets(d, userId);
  if (!budgets.length) return [];
  const month = day.slice(0, 7);
  const spent = new Map<string | null, number>();
  for (const p of monthFlow(d, userId, month).month_parts) spent.set(p.category_id, (spent.get(p.category_id) ?? 0) + p.base_minor);
  const names = new Map(readCategories(d, userId).map((c) => [c.id, c.name]));
  const out: MoneyPush[] = [];
  for (const b of budgets) {
    const sum = spent.get(b.category_id) ?? 0;
    const share = (sum / b.limit_minor) * 100;
    const level = LEVELS.find((l) => share >= l);
    if (!level) continue;
    // Сразу перешли за 100% — про 80% уже не говорим.
    const fresh = mark(d, userId, `budget:${b.category_id}:${month}:${level}`);
    if (level === 100) mark(d, userId, `budget:${b.category_id}:${month}:80`);
    if (!fresh) continue;
    const name = names.get(b.category_id) ?? 'Категория';
    out.push(
      level === 100
        ? {
            title: `Бюджет «${name}» кончился`,
            body: `Потрачено ${money(sum, s.base_currency)} из ${money(b.limit_minor, s.base_currency)}${sum > b.limit_minor ? ` — сверх на ${money(sum - b.limit_minor, s.base_currency)}` : ''}.`,
            tag: `money-budget:${b.category_id}`,
            url: '/task/money/report#budgets',
          }
        : {
            title: `«${name}»: потрачено ${Math.floor(share)}% бюджета`,
            body: `Осталось ${money(b.limit_minor - sum, s.base_currency)} из ${money(b.limit_minor, s.base_currency)} на месяц.`,
            tag: `money-budget:${b.category_id}`,
            url: '/task/money/report#budgets',
          },
    );
  }
  return out;
}

/** Итог трат за день: сколько, сколько операций и на что больше всего. */
export function eveningText(d: Database.Database, userId: string, day: string): MoneyPush {
  const s = readMoneySettings(d, userId)!;
  const f = flow(d, userId, day, day);
  const total = f.parts.reduce((a, p) => a + p.base_minor, 0);
  const count = new Set(f.parts.map((p) => p.op_id)).size;
  const names = new Map(readCategories(d, userId).map((c) => [c.id, c.name]));
  const byCat = new Map<string | null, number>();
  for (const p of f.parts) byCat.set(p.category_id, (byCat.get(p.category_id) ?? 0) + p.base_minor);
  const top = [...byCat].filter(([id]) => id).sort((a, b) => b[1] - a[1])[0];
  return {
    title: 'Траты за день',
    body: count
      ? `Сегодня ${money(total, s.base_currency)} · ${plural(count, 'операция', 'операции', 'операций')}${top ? `. Больше всего — ${names.get(top[0]!) ?? 'категория'}, ${money(top[1], s.base_currency)}` : ''}.`
      : 'Сегодня трат не записано. Если что-то покупали — запишите, пока помните.',
    tag: `money-evening:${day}`,
    url: '/task/money',
  };
}

/**
 * Что отправить этому человеку сейчас. day и minutes — местные (пояс его
 * устройства); quietNow — идут тихие часы: ничего не шлём и не помечаем.
 */
export function moneyPushes(d: Database.Database, userId: string, day: string, minutes: number, quietNow: boolean): MoneyPush[] {
  if (quietNow || !moneyAllowed(userId, userLogin(userId))) return [];
  const s = readMoneySettings(d, userId);
  if (!s) return [];
  const out = budgetPushes(d, userId, day);
  if (s.evening_push) {
    const late = minutes - minutesOf(s.evening_push);
    if (late >= 0 && late <= WINDOW_MIN && mark(d, userId, `evening:${day}`)) out.push(eveningText(d, userId, day));
  }
  return out;
}

/** Старые отметки не нужны: месяц бюджета и день итога давно прошли. */
export function pruneMoneyPush(d: Database.Database): void {
  d.prepare("delete from money_push_sent where created_at < datetime('now', '-70 day')").run();
}
