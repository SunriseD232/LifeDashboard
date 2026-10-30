/**
 * Валюты «Денег»: код, название, сколько знаков после запятой (суммы в базе —
 * целые числа в этих единицах: 12,40 € → 1240) и знак для показа.
 *
 * Курс к рублю берём у ЦБ (src/server/moneyRates.ts). Каких там нет —
 * криптовалюты и редкие валюты — курс человек указывает сам.
 */

export interface Currency {
  code: string;
  name: string;
  /** Знаков после запятой. */
  digits: number;
  symbol?: string;
  /** Курс у ЦБ обычно есть — подсказка в списке; точно решают данные ЦБ. */
  cbr?: boolean;
}

const C = (code: string, name: string, digits = 2, symbol?: string, cbr = true): Currency => ({ code, name, digits, symbol, cbr });

export const CURRENCIES: Currency[] = [
  C('RUB', 'Российский рубль', 2, '₽'),
  C('USD', 'Доллар США', 2, '$'),
  C('EUR', 'Евро', 2, '€'),
  C('CNY', 'Китайский юань', 2, '¥'),
  C('KZT', 'Казахстанский тенге', 2, '₸'),
  C('BYN', 'Белорусский рубль', 2, 'Br'),
  C('GEL', 'Грузинский лари', 2, '₾'),
  C('AMD', 'Армянский драм', 2, '֏'),
  C('AZN', 'Азербайджанский манат', 2, '₼'),
  C('TRY', 'Турецкая лира', 2, '₺'),
  C('AED', 'Дирхам ОАЭ', 2),
  C('GBP', 'Фунт стерлингов', 2, '£'),
  C('CHF', 'Швейцарский франк', 2),
  C('JPY', 'Японская иена', 0, '¥'),
  C('KRW', 'Южнокорейская вона', 0, '₩'),
  C('INR', 'Индийская рупия', 2, '₹'),
  C('THB', 'Тайский бат', 2, '฿'),
  C('VND', 'Вьетнамский донг', 0, '₫'),
  C('IDR', 'Индонезийская рупия', 2),
  C('UZS', 'Узбекский сум', 2),
  C('KGS', 'Киргизский сом', 2),
  C('TJS', 'Таджикский сомони', 2),
  C('TMT', 'Туркменский манат', 2),
  C('MDL', 'Молдавский лей', 2),
  C('UAH', 'Украинская гривна', 2, '₴'),
  C('PLN', 'Польский злотый', 2, 'zł'),
  C('CZK', 'Чешская крона', 2, 'Kč'),
  C('HUF', 'Венгерский форинт', 2, 'Ft'),
  C('RON', 'Румынский лей', 2),
  C('BGN', 'Болгарский лев', 2),
  C('RSD', 'Сербский динар', 2),
  C('SEK', 'Шведская крона', 2, 'kr'),
  C('NOK', 'Норвежская крона', 2, 'kr'),
  C('DKK', 'Датская крона', 2, 'kr'),
  C('CAD', 'Канадский доллар', 2),
  C('AUD', 'Австралийский доллар', 2),
  C('NZD', 'Новозеландский доллар', 2),
  C('HKD', 'Гонконгский доллар', 2),
  C('SGD', 'Сингапурский доллар', 2),
  C('BRL', 'Бразильский реал', 2, 'R$'),
  C('ZAR', 'Южноафриканский рэнд', 2),
  C('EGP', 'Египетский фунт', 2),
  C('QAR', 'Катарский риал', 2),
  C('SAR', 'Саудовский риял', 2),
  C('BHD', 'Бахрейнский динар', 3),
  C('OMR', 'Оманский риал', 3),
  C('MNT', 'Монгольский тугрик', 2, '₮'),
  C('ILS', 'Израильский шекель', 2, '₪', false),
  C('MXN', 'Мексиканское песо', 2, undefined, false),
  C('ARS', 'Аргентинское песо', 2, undefined, false),
  C('MYR', 'Малайзийский ринггит', 2, undefined, false),
  C('PHP', 'Филиппинское песо', 2, '₱', false),
  C('ISK', 'Исландская крона', 0, undefined, false),
  C('KWD', 'Кувейтский динар', 3, undefined, false),
  C('XDR', 'СДР (МВФ)', 2),
  C('USDT', 'Tether', 2, undefined, false),
  C('USDC', 'USD Coin', 2, undefined, false),
  C('BTC', 'Биткоин', 8, '₿', false),
  C('ETH', 'Эфир', 8, undefined, false),
  C('TON', 'Toncoin', 6, undefined, false),
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currency(code: string): Currency {
  return BY_CODE.get(code) ?? { code, name: code, digits: 2 };
}

export function isCurrency(code: unknown): code is string {
  return typeof code === 'string' && BY_CODE.has(code);
}

/** Часто нужные — наверху списка при первом запуске. */
export const POPULAR = ['USD', 'EUR', 'CNY', 'KZT', 'GEL', 'TRY', 'AED', 'USDT'];

/**
 * «1 234,50» → 123450 (в единицах валюты). Понимает пробелы и неразрывные
 * пробелы в тысячах, запятую и точку как дробную часть. Не число, минус или
 * слишком много знаков после запятой — null.
 */
export function parseAmount(raw: string, code: string): number | null {
  const { digits } = currency(code);
  let s = raw.replace(/[\s  ']/g, '');
  if (!s) return null;
  // «1.234,56» и «1,234.56»: дробная часть — после последнего разделителя,
  // остальные разделители — тысячи. Разделитель одного вида дважды
  // («1,234,567») или три цифры после него там, где копеек две («1,234») —
  // тоже тысячи.
  const seps = s.match(/[.,]/g) ?? [];
  if (seps.length) {
    const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    const tail = s.slice(last + 1);
    const oneKind = new Set(seps).size === 1;
    const thousands = oneKind && (seps.length > 1 || (tail.length === 3 && digits < 3));
    s = thousands ? s.replace(/[.,]/g, '') : `${s.slice(0, last).replace(/[.,]/g, '')}.${tail}`;
  }
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  if (frac.length > digits) return null;
  const n = Number(int) * 10 ** digits + Number((frac + '0'.repeat(digits)).slice(0, digits) || 0);
  return Number.isSafeInteger(n) ? n : null;
}

/** 123450 → «1 234,50» (без знака валюты). */
export function formatMinor(minor: number, code: string, opts: { trim?: boolean } = {}): string {
  const { digits } = currency(code);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const int = Math.floor(abs / 10 ** digits);
  const frac = digits ? String(abs % 10 ** digits).padStart(digits, '0') : '';
  const intText = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const showFrac = digits > 0 && !(opts.trim && /^0+$/.test(frac));
  return `${neg ? '−' : ''}${intText}${showFrac ? `,${frac}` : ''}`;
}

/** 123450, RUB → «1 234,50 ₽»; без знака — «1 234,50 KZT». */
export function money(minor: number, code: string, opts: { trim?: boolean; sign?: boolean } = {}): string {
  const c = currency(code);
  const text = formatMinor(minor, code, opts);
  const plus = opts.sign && minor > 0 ? '+' : '';
  return `${plus}${text} ${c.symbol ?? c.code}`;
}
