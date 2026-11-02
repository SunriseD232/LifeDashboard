import { isCurrency } from './currencies';
import { parseSigned } from './moneyImport';

/**
 * SMS и push банков → операция. «Команды» iOS присылают текст сообщения,
 * мы достаём сумму, валюту, место, карту и что это — трата или поступление.
 * Без ИИ: в сообщениях бывают коды подтверждения, их никуда не отправляем.
 * Не похоже на операцию (код, отказ, реклама) — null.
 */
export interface SmsOp {
  kind: 'expense' | 'income';
  amount: number;
  currency: string;
  payee: string;
  card_last4: string | null;
  /** «Возврат», «Отмена покупки» — деньги за трату вернулись. */
  refund: boolean;
}

const CURRENCY: [RegExp, string][] = [
  [/^(р|р\.|руб\.?|rub|rur|₽)$/i, 'RUB'],
  [/^(\$|usd)$/i, 'USD'],
  [/^(€|eur)$/i, 'EUR'],
  [/^(kzt|₸|тг)$/i, 'KZT'],
  [/^(gel|₾)$/i, 'GEL'],
  [/^(try|₺)$/i, 'TRY'],
  [/^(cny|¥)$/i, 'CNY'],
];

function code(w: string): string | null {
  for (const [re, c] of CURRENCY) if (re.test(w)) return c;
  const up = w.toUpperCase();
  return isCurrency(up) ? up : null;
}

const SKIP = /(код|пароль|code|otp|не сообщайте|отказ|отклон|недостаточно|declined|insufficient|вход в|войти|подтвердите)/i;
const REFUND = /(возврат|отмен|refund|reversal|cancel)/i;
const INCOME = /(зачислен|поступлен|пополнен|перевод от|получен|возврат|отмен|refund|reversal|cancel|credited|incoming|зарплат|кешб[эе]к|cashback)/i;
const EXPENSE = /(покупк|списан|оплат|перевод|снятие|выдача|purchase|payment|debited|withdraw|spent)/i;
const BALANCE = /(баланс|доступно|остаток|ост\.?|balance|available|limit|лимит)/i;
// Сумма с валютой: «1 477,60р», «350 RUB», «$5.99», «2,99 €».
const AMOUNT = /(?:([$€₽₸₾₺¥])\s?(\d[\d\s ]*(?:[.,]\d{1,2})?))|(?:(\d[\d\s ]*(?:[.,]\d{1,2})?)\s?(р\.?|руб\.?|rub|rur|usd|eur|kzt|gel|try|cny|₽|\$|€|₸|₾|₺|¥|тг)(?![a-zа-я]))/gi;

export function parseBankSms(raw: string): SmsOp | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || SKIP.test(text)) return null;
  const income = INCOME.test(text);
  if (!income && !EXPENSE.test(text)) return null;

  // Первая сумма, перед которой не стоит «Баланс»/«Доступно».
  let found: { amount: number; currency: string; end: number; start: number } | null = null;
  for (const m of text.matchAll(AMOUNT)) {
    const before = text.slice(Math.max(0, m.index! - 14), m.index);
    if (BALANCE.test(before)) continue;
    const num = m[2] ?? m[3];
    const cur = code(m[1] ?? m[4]);
    const n = parseSigned(num.replace(/[\s ]/g, ''));
    if (!n || !cur) continue;
    found = { amount: Math.abs(n), currency: cur, start: m.index!, end: m.index! + m[0].length };
    break;
  }
  if (!found) return null;

  const card = /(?:\*|карт[аы]?\s*\*?|счет\*?|сч[её]т\s*\*?|mir-?|ecmc|visa|maestro|mc)\s?(\d{4})\b/i.exec(text)?.[1] ?? null;
  return { kind: income ? 'income' : 'expense', amount: found.amount, currency: found.currency, payee: merchant(text, found.start, found.end), card_last4: card, refund: REFUND.test(text) };
}

/** Место: текст после суммы до «Баланс»; нет — перед суммой после слова операции. */
function merchant(text: string, start: number, end: number): string {
  const clean = (s: string) =>
    s
      .replace(BALANCE, '|')
      .split('|')[0]
      .replace(/(?:\*|карт[аы]?|счет|сч[её]т|mir-?|ecmc|visa)\s?\*?\d{4}/gi, ' ')
      .replace(/\b\d{1,2}[:.]\d{2}(?:[:.]\d{2,4})?\b/g, ' ')
      .replace(/^[\s.,:;–—+-]+|[\s.,:;–—+-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  let after = clean(text.slice(end));
  // «Покупка, карта *1234. 350 RUB. KOFEMANIYA. Доступно…» — место между точками.
  after = after.split(/\.\s/)[0].trim();
  if (after && /\p{L}/u.test(after)) return pretty(after);
  const before = clean(text.slice(0, start).replace(new RegExp(`^.*?(${EXPENSE.source}|${INCOME.source})\\S*`, 'i'), ''));
  return before && /\p{L}/u.test(before) ? pretty(before) : '';
}

/** «KOFEMANIYA» → «Kofemaniya»; русское — как есть, с большой буквы. */
function pretty(s: string): string {
  const t = s.slice(0, 80);
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return t.charAt(0).toUpperCase() + t.slice(1);
}
