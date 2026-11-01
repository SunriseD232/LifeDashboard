import type { NavPref } from './nav';
import { currency, isCurrency, parseAmount } from './currencies';
import type { MoneyDebt, MoneyGoal, MoneyRecurring } from './moneyPlans';

/** «Деньги»: общие для сервера и экрана типы и расчёты. */

export type OpKind = 'expense' | 'income' | 'transfer' | 'exchange';
export const OP_KINDS: OpKind[] = ['expense', 'income', 'transfer', 'exchange'];
export type AccountKind = 'card' | 'cash' | 'deposit' | 'other';
export const ACCOUNT_KINDS: { id: AccountKind; label: string }[] = [
  { id: 'card', label: 'Карта или счёт' },
  { id: 'cash', label: 'Наличные' },
  { id: 'deposit', label: 'Вклад или накопления' },
  { id: 'other', label: 'Другое' },
];

export interface MoneyAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  opening_minor: number;
  archived: boolean;
  position: number;
  /** Семейный — видят все в семье. */
  shared: boolean;
  /** Завёл я — могу править и удалять. */
  mine: boolean;
  /** Кто завёл, если не я. */
  author: string | null;
  balance_minor: number;
  /** Последние 4 цифры карты — по ним SMS попадает на этот счёт. */
  card_last4: string | null;
}

export interface MoneyCategory {
  id: string;
  kind: 'expense' | 'income';
  name: string;
  position: number;
}

export interface MoneyOp {
  id: string;
  kind: OpKind;
  day: string;
  account_id: string;
  amount_minor: number;
  currency: string;
  to_account_id: string | null;
  to_amount_minor: number | null;
  to_currency: string | null;
  orig_amount_minor: number | null;
  orig_currency: string | null;
  category_id: string | null;
  /** Название категории — у семейной операции она может быть чужой. */
  category_name: string | null;
  payee: string | null;
  note: string | null;
  source: string;
  /** Деньги по долгу — двигают остаток, но не траты и не доходы. */
  debt_id: string | null;
  mine: boolean;
  author: string | null;
  items_count: number;
}

export interface MoneySettings {
  base_currency: string;
  currencies: string[];
  hidden: string[];
}

export interface MoneyState {
  /** null — первый запуск ещё не пройден. */
  settings: MoneySettings | null;
  accounts: MoneyAccount[];
  categories: MoneyCategory[];
  /** Операции выбранного месяца, новые сверху. */
  ops: MoneyOp[];
  month: string;
  /** Рублей за 1 единицу: последний курс ЦБ или свой. RUB = 1. */
  rates: Record<string, number>;
  /** На какой день курсы ЦБ (null — ещё не загружены). */
  rates_day: string | null;
  /** Свои курсы для валют без курса ЦБ. */
  user_rates: Record<string, number>;
  /** Состоит ли в семье — тогда можно заводить семейные счета. */
  family: boolean;
  login: string | null;
  /** Порядок разделов LifeDashboard — для бокового меню на компьютере. */
  nav?: NavPref[] | null;
  /** ИИ подключён на сервере — есть голос, фото чеков и разбор фраз. */
  ai: boolean;
  /** Бюджеты на месяц по категориям расходов, в основной валюте. */
  budgets: { category_id: string; limit_minor: number }[];
  /** Траты месяца по категориям в основной валюте (чек — по позициям). */
  month_parts: { op_id: string; category_id: string | null; base_minor: number }[];
  /** Траты прошлого месяца в основной валюте: по своим и семейным счетам. */
  prev_spend: { mine: number; family: number };
  /** Регулярные платежи, долги, цели — свои. */
  recurring: MoneyRecurring[];
  debts: MoneyDebt[];
  goals: MoneyGoal[];
  /** Бюджет семьи на месяц — на все траты с семейных счетов; null — не задан или нет семьи. */
  family_budget: { limit_minor: number; currency: string } | null;
  /** Подключены SMS от банка (есть ключ для «Команд»). */
  sms_on: boolean;
}

/**
 * Что можно спрятать (Настройки → Что показывать). Пока только то, что уже
 * работает; остальные модули добавятся со своими этапами.
 */
export const MODULES: { id: string; label: string; hint?: string }[] = [
  { id: 'accounts', label: 'Несколько счетов', hint: 'Выключено — один кошелёк' },
  { id: 'currencies', label: 'Валюты и обмен' },
  { id: 'family', label: 'Семейные счета' },
  { id: 'ai', label: 'Разбор фраз ИИ', hint: 'Выключено — простой разбор: «кофе 350»' },
  { id: 'voice', label: 'Ввод голосом' },
  { id: 'receipts', label: 'Фото чеков', hint: 'Позиции, категории, проверка по QR' },
  { id: 'import', label: 'Импорт выписок', hint: 'Файлы банков и скриншоты' },
  { id: 'budgets', label: 'Бюджеты', hint: 'Лимиты на месяц по категориям' },
  { id: 'prices', label: 'Цены из чеков', hint: 'Как дорожают продукты' },
  { id: 'recurring', label: 'Регулярные платежи', hint: 'Подписки, аренда, зарплата' },
  { id: 'debts', label: 'Долги', hint: 'Кто кому должен' },
  { id: 'goals', label: 'Цели', hint: 'Копить на что-то' },
  { id: 'sms', label: 'SMS от банка', hint: 'Через «Команды» iOS' },
];

export const DEFAULT_CATEGORIES: { kind: 'expense' | 'income'; names: string[] }[] = [
  {
    kind: 'expense',
    names: ['Продукты', 'Кафе', 'Транспорт', 'Дом и ЖКХ', 'Связь и интернет', 'Здоровье', 'Одежда', 'Развлечения', 'Подписки', 'Подарки', 'Бытовая химия', 'Комиссии', 'Другое'],
  },
  { kind: 'income', names: ['Зарплата', 'Подработка', 'Подарки', 'Проценты и кешбэк', 'Другое'] },
];

/** Как операция меняет остаток счёта: >0 — пришло, <0 — ушло. */
export function opEffect(op: Pick<MoneyOp, 'kind' | 'account_id' | 'amount_minor' | 'to_account_id' | 'to_amount_minor'>, accountId: string): number {
  let n = 0;
  if (op.account_id === accountId) n += op.kind === 'income' ? op.amount_minor : -op.amount_minor;
  if ((op.kind === 'transfer' || op.kind === 'exchange') && op.to_account_id === accountId) n += op.to_amount_minor ?? 0;
  return n;
}

/**
 * Перевод суммы в другую валюту через рубль: rateOf(код) — рублей за 1
 * единицу (у RUB — 1). Нет курса одной из валют — null.
 */
export function convert(minor: number, from: string, to: string, rateOf: (code: string) => number | null | undefined): number | null {
  if (from === to) return minor;
  const rf = from === 'RUB' ? 1 : rateOf(from);
  const rt = to === 'RUB' ? 1 : rateOf(to);
  if (!rf || !rt) return null;
  const units = minor / 10 ** currency(from).digits;
  return Math.round(((units * rf) / rt) * 10 ** currency(to).digits);
}

/** Курс обмена: сколько единиц «получил» за 1 «отдал» (500 $ → 40 250 ₽: 80,5). */
export function exchangeRate(giveMinor: number, giveCode: string, getMinor: number, getCode: string): number | null {
  if (!giveMinor) return null;
  const give = giveMinor / 10 ** currency(giveCode).digits;
  const get = getMinor / 10 ** currency(getCode).digits;
  return get / give;
}

/**
 * Название товара из чека без веса, объёма и процентов — по нему потом
 * сравниваем цены: «Молоко 2,5% 930 мл» → «молоко».
 */
export function normItem(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(?<![\p{L}\p{N}])\d+([.,]\d+)?\s*(%|г|гр|кг|мл|л|шт|уп)?(?=\s|$|[.,;)])/gu, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/^(₽|р|р\.|руб\.?|рубл\S*|rub)$/i, 'RUB'],
  [/^(\$|usd|долл\S*|бакс\S*)$/i, 'USD'],
  [/^(€|eur|евро)$/i, 'EUR'],
  [/^(¥|cny|юан\S*)$/i, 'CNY'],
  [/^(₸|kzt|тенге)$/i, 'KZT'],
  [/^(₾|gel|лари)$/i, 'GEL'],
  [/^(₺|try|лир\S*)$/i, 'TRY'],
  [/^(£|gbp|фунт\S*)$/i, 'GBP'],
  [/^(usdt|тетер\S*)$/i, 'USDT'],
];

function currencyWord(w: string): string | null {
  for (const [re, code] of CURRENCY_WORDS) if (re.test(w)) return code;
  const up = w.toUpperCase();
  return isCurrency(up) ? up : null;
}

export interface QuickParse {
  title: string;
  amount_minor: number | null;
  currency: string | null;
  /** 0 — сегодня, 1 — вчера, 2 — позавчера. */
  days_ago: number;
}

/**
 * Быстрый разбор строки ввода без ИИ: «кофе 350», «такси 12 € вчера»,
 * «$5 кофе». Число — сумма, слово или знак валюты рядом — валюта, «вчера» и
 * «позавчера» — дата, остальное — название. Валюта без неё — fallback.
 */
export function quickParse(text: string, fallback: string): QuickParse {
  // Знак валюты, приклеенный к числу («12€», «$5»), — отдельным словом.
  const words = text
    .replace(/([₽$€¥₸₾₺£])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
  let days = 0;
  let code: string | null = null;
  let rawAmount: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lw = w.toLowerCase().replace(/[.,!]+$/, '');
    if (lw === 'вчера') days = 1;
    else if (lw === 'позавчера') days = 2;
    else if (lw === 'сегодня') days = 0;
    else if (!rawAmount && /^\d[\d\s.,]*$/.test(w)) {
      // «1 200» — тысячи через пробел: склеиваем со следующим «200».
      let joined = w;
      while (/^\d{1,3}(\d{3})*$/.test(joined) && /^\d{3}([.,]\d+)?$/.test(words[i + 1] ?? '')) joined += words[++i];
      rawAmount = joined;
    } else if (!code && currencyWord(lw)) code = currencyWord(lw);
    else rest.push(w);
  }
  const cur = code ?? fallback;
  const title = rest.join(' ').trim();
  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : '',
    amount_minor: rawAmount ? parseAmount(rawAmount, cur) : null,
    currency: code,
    days_ago: days,
  };
}
